import { parseSnapshot } from './parse-snapshot';

/**
 * «Золотая» таблица: точный итог (код, путь, ТЕКСТ) на каждый случай. Ожидания записаны
 * генератором с собранного пакета и прочитаны глазами; изменение поведения или текста находки
 * обязано менять эту таблицу осознанно.
 */

const ENTRY = {
  role: 'reader',
  version: '1.0.0',
  versionField: 'contractVersion',
  legacyVersion: null,
  extraFields: 'refused',
  shape: { kind: 'string' },
  wire: {},
  examples: [],
};
const SHAPES: ReadonlyArray<readonly [string, unknown, string]> = [
  [
    'не объект',
    'x',
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): форма — не объект',
  ],
  ['массив', [], 'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): форма — не объект'],
  [
    'неизвестный вид',
    { kind: 'set' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): неизвестный вид формы "set"',
  ],
  [
    'вид не строка',
    { kind: 1 },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): неизвестный вид формы 1',
  ],
  [
    'лишний ключ',
    { kind: 'number', integer: true, flags: 'x' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): незнакомые ключи узла «number»: flags',
  ],
  [
    'minLength не число',
    { kind: 'string', minLength: '1' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): minLength — не число',
  ],
  [
    'maxLength NaN',
    { kind: 'string', maxLength: null },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): maxLength — не число',
  ],
  [
    'patterns не список',
    { kind: 'string', patterns: '/a/' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): patterns — не список строк',
  ],
  [
    'patterns: не строки',
    { kind: 'string', patterns: [1] },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): patterns — не список строк',
  ],
  [
    'шаблон-не-литерал',
    { kind: 'string', patterns: ['^a'] },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): шаблон "^a" — не литерал /…/флаги или не компилируется',
  ],
  [
    'formats: не строки',
    { kind: 'string', formats: [1] },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): formats — не список строк',
  ],
  [
    'number: границы не числа',
    { kind: 'number', minimum: 'a' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): minimum — не число',
  ],
  [
    'number: integer не true',
    { kind: 'number', integer: false },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): integer — не true',
  ],
  [
    'number: multipleOf',
    { kind: 'number', multipleOf: '2' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): multipleOf — не число',
  ],
  [
    'enum без values',
    { kind: 'enum' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): enum без списка строк',
  ],
  [
    'enum с числом',
    { kind: 'enum', values: [1] },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): enum без списка строк',
  ],
  [
    'литерал-строка',
    { kind: 'literal', value: 'a' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): литерал не число и не булево',
  ],
  [
    'template без pattern',
    { kind: 'template' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): шаблон без pattern',
  ],
  [
    'template не компилируется',
    { kind: 'template', pattern: '(' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): шаблон "(" не компилируется',
  ],
  [
    'object без fields',
    { kind: 'object', unknownKeys: 'strip' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): объект без fields',
  ],
  [
    'object: fields массив',
    { kind: 'object', fields: [], unknownKeys: 'strip' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): объект без fields',
  ],
  [
    'object: политика',
    { kind: 'object', fields: {}, unknownKeys: 'drop' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): неизвестная политика лишних полей "drop"',
  ],
  [
    'object: поле без optional',
    { kind: 'object', fields: { a: { shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): поле a без optional',
  ],
  [
    'object: поле null',
    { kind: 'object', fields: { a: null }, unknownKeys: 'strip' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): поле a без optional',
  ],
  [
    'object: лишний ключ поля',
    {
      kind: 'object',
      fields: { a: { optional: true, shape: { kind: 'string' }, deprecated: true } },
      unknownKeys: 'strip',
    },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): поле a: незнакомые ключи deprecated',
  ],
  [
    'object: вложенная форма',
    { kind: 'object', fields: { a: { optional: true, shape: { kind: 'x' } } }, unknownKeys: 'strip' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: a: неизвестный вид формы "x"',
  ],
  [
    'object: вложенный путь',
    {
      kind: 'object',
      fields: {
        a: {
          optional: true,
          shape: {
            kind: 'object',
            fields: { b: { optional: true, shape: { kind: 'x' } } },
            unknownKeys: 'strip',
          },
        },
      },
      unknownKeys: 'strip',
    },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: a.b: неизвестный вид формы "x"',
  ],
  [
    'object: rest',
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'x' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: {*}: неизвестный вид формы "x"',
  ],
  [
    'record: key',
    { kind: 'record', key: { kind: 'x' }, value: { kind: 'string' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: {key}: неизвестный вид формы "x"',
  ],
  [
    'record: value',
    { kind: 'record', key: { kind: 'string' }, value: { kind: 'x' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: {*}: неизвестный вид формы "x"',
  ],
  [
    'array: element',
    { kind: 'array', element: { kind: 'x' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: []: неизвестный вид формы "x"',
  ],
  [
    'array: minItems',
    { kind: 'array', element: { kind: 'string' }, minItems: 'x' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): minItems — не число',
  ],
  [
    'tuple без items',
    { kind: 'tuple' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): кортеж без items',
  ],
  [
    'tuple: член',
    { kind: 'tuple', items: [{ kind: 'string' }, { kind: 'x' }] },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: [1]: неизвестный вид формы "x"',
  ],
  [
    'tuple: rest',
    { kind: 'tuple', items: [], rest: { kind: 'x' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: [...]: неизвестный вид формы "x"',
  ],
  [
    'union без options',
    { kind: 'union' },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): объединение без options',
  ],
  [
    'union: вариант',
    { kind: 'union', options: [{ kind: 'x' }] },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: |0: неизвестный вид формы "x"',
  ],
  [
    'opaque без reason',
    { kind: 'opaque', upper: { kind: 'string' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): непрозрачный узел без reason',
  ],
  [
    'opaque: пустой reason',
    { kind: 'opaque', reason: '', upper: { kind: 'string' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): непрозрачный узел без reason',
  ],
  [
    'opaque: upper',
    { kind: 'opaque', reason: 'r', upper: { kind: 'x' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): неизвестный вид формы "x"',
  ],
  [
    'opaque: lower',
    { kind: 'opaque', reason: 'r', upper: { kind: 'string' }, lower: { kind: 'x' } },
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): неизвестный вид формы "x"',
  ],
];
const DOCUMENTS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'не JSON',
    '{',
    "SnapshotFormatError: peer: не снимок контрактов: не JSON (Expected property name or '}' in JSON at position 1 (line 1 column 2))",
  ],
  [
    'format чужой',
    '{"format":"x","contracts":{}}',
    'SnapshotFormatError: peer: не снимок контрактов: поле format "x", ожидалось "contracts-snapshot/2"',
  ],
  [
    'format /1',
    '{"format":"contracts-snapshot/1","contracts":{}}',
    'SnapshotFormatError: peer: не снимок контрактов: снимок формата /1 (библиотека до 0.2.0): он не отличал z.unknown() от потерянной семантики (coerce, transform) и не нёс политику записи — пересоберите снимок этой стороны библиотекой 0.2.0 или новее',
  ],
  ['null', 'null', 'SnapshotFormatError: peer: не снимок контрактов: документ — не объект, а null'],
  [
    'нет contracts',
    '{"format":"contracts-snapshot/2"}',
    'SnapshotFormatError: peer: не снимок контрактов: нет словаря contracts',
  ],
  [
    'contracts массив',
    '{"format":"contracts-snapshot/2","contracts":[]}',
    'SnapshotFormatError: peer: не снимок контрактов: нет словаря contracts',
  ],
  [
    'запись не объект',
    '{"format":"contracts-snapshot/2","contracts":{"m":1}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: запись не объект',
  ],
  [
    'запись null',
    '{"format":"contracts-snapshot/2","contracts":{"m":null}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: запись не объект',
  ],
  [
    'лишний ключ записи',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{},"examples":[],"owner":"x"}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: незнакомые ключи записи: owner',
  ],
  [
    'роль',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"proxy","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: неизвестная роль "proxy"',
  ],
  [
    'версия',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"x","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: версия не разобрана: "x"',
  ],
  [
    'versionField',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":1,"legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: versionField — не строка и не null',
  ],
  [
    'legacyVersion',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":"x","extraFields":"refused","shape":{"kind":"string"},"wire":{},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: legacyVersion — не версия и не null: "x"',
  ],
  [
    'extraFields',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"maybe","shape":{"kind":"string"},"wire":{},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: неизвестная политика записи extraFields "maybe"',
  ],
  [
    'форма',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"x"},"wire":{},"examples":[]}}}',
    'SnapshotFormatError: peer: контракт m: не снимок контрактов: (корень): неизвестный вид формы "x"',
  ],
  [
    'wire не словарь',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":[],"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire — не словарь',
  ],
  [
    'wire null',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":null,"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire — не словарь',
  ],
  [
    'wire тип',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"regexp"}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: неизвестный тип "regexp"',
  ],
  [
    'wire значение null',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":null},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: не объект',
  ],
  [
    'examples',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{},"examples":{}}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: examples — не массив',
  ],
  [
    'контроль: годный',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{},"examples":[]}}}',
    'ok',
  ],
  [
    'wire: не объект',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":"x"},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: не объект',
  ],
  [
    'wire: массив',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":[]},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: не объект',
  ],
  [
    'wire: тип не строка',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":1}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: неизвестный тип 1',
  ],
  [
    'wire: string без value',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"string"}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа string',
  ],
  [
    'wire: string с числом',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"string","value":1}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа string',
  ],
  [
    'wire: number строкой',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"number","value":"1"}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа number',
  ],
  [
    'wire: number null',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"number","value":null}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа number',
  ],
  [
    'wire: boolean строкой',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"boolean","value":"true"}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа boolean',
  ],
  [
    'wire: null с value',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"null","value":1}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: незнакомые поля value',
  ],
  [
    'wire: template без value',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"template","arity":1}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа template',
  ],
  [
    'wire: template arity строкой',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"template","arity":"1","value":"k"}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа template',
  ],
  [
    'wire: template arity дробная',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"template","arity":1.5,"value":"k"}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа template',
  ],
  [
    'wire: template arity отрицательная',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"q":{"type":"template","arity":-1,"value":"k"}},"examples":[]}}}',
    'SnapshotFormatError: peer: не снимок контрактов: контракт m: wire q: значение не того вида для типа template',
  ],
  [
    'wire: годные значения всех типов',
    '{"format":"contracts-snapshot/2","contracts":{"m":{"role":"reader","version":"1.0.0","versionField":"contractVersion","legacyVersion":null,"extraFields":"refused","shape":{"kind":"string"},"wire":{"s":{"type":"string","value":"a"},"n":{"type":"number","value":1},"b":{"type":"boolean","value":false},"z":{"type":"null"},"t":{"type":"template","arity":0,"value":"k"}},"examples":[]}}}',
    'ok',
  ],
];
const outcome = (text: string): string => {
  try {
    parseSnapshot(text, 'peer');
    return 'ok';
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
};

describe('parseSnapshot: точные отказы', () => {
  it.each(SHAPES)('форма: %s', (_name, shape, expected) => {
    expect(
      outcome(JSON.stringify({ format: 'contracts-snapshot/2', contracts: { m: { ...ENTRY, shape } } })),
    ).toBe(expected);
  });

  it.each(DOCUMENTS)('документ: %s', (_name, text, expected) => {
    expect(outcome(text)).toBe(expected);
  });
});
