import { assertShape } from './assert-shape';

/**
 * «Золотая» таблица разбора формы из чужого снимка: допустимые узлы, которые
 * проверка не должна отвергнуть (литералы, integer, ключи словаря всех видов,
 * кортеж без rest), и недопустимые — с точным текстом, где назван узел и ключ.
 * Ожидания записаны с собранного пакета и прочитаны глазами.
 */
const S = { kind: 'string' };
const CASES: ReadonlyArray<readonly [string, unknown, string]> = [
  [
    'null как форма поля',
    { kind: 'object', unknownKeys: 'strip', fields: { a: { optional: false, shape: null } } },
    'SnapshotFormatError: peer: не снимок контрактов: a: форма — не объект',
  ],
  [
    'вид — имя свойства прототипа',
    { kind: 'toString' },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): неизвестный вид формы "toString"',
  ],
  [
    'вид — массив со строкой',
    { kind: ['string'] },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): неизвестный вид формы ["string"]',
  ],
  [
    'несколько незнакомых ключей узла',
    { kind: 'boolean', x: 1, y: 2 },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): незнакомые ключи узла «boolean»: x, y',
  ],
  [
    'exclusiveMinimum не число',
    { kind: 'number', exclusiveMinimum: 'x' },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): exclusiveMinimum — не число',
  ],
  [
    'maximum не число',
    { kind: 'number', maximum: 'x' },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): maximum — не число',
  ],
  [
    'exclusiveMaximum не число',
    { kind: 'number', exclusiveMaximum: 'x' },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): exclusiveMaximum — не число',
  ],
  ['integer true — допустим', { kind: 'number', integer: true, minimum: 0, exclusiveMaximum: 10 }, 'ok'],
  [
    'integer не true',
    { kind: 'number', integer: false },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): integer — не true',
  ],
  [
    'maxItems не число',
    { kind: 'array', element: S, maxItems: 'x' },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): maxItems — не число',
  ],
  [
    'patterns со значением не строкой',
    { kind: 'string', patterns: ['/a/', 1] },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): patterns — не список строк',
  ],
  [
    'enum со значением не строкой',
    { kind: 'enum', values: ['a', 1] },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): enum без списка строк',
  ],
  ['литерал-число', { kind: 'literal', value: 1 }, 'ok'],
  ['литерал-булево', { kind: 'literal', value: true }, 'ok'],
  [
    'литерал-строка',
    { kind: 'literal', value: 'x' },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): литерал не число и не булево',
  ],
  [
    'fields: null',
    { kind: 'object', fields: null, unknownKeys: 'strip' },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): объект без fields',
  ],
  [
    'поле с несколькими незнакомыми ключами',
    { kind: 'object', unknownKeys: 'strip', fields: { a: { optional: true, shape: S, x: 1, y: 2 } } },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): поле a: незнакомые ключи x, y',
  ],
  ['ключ словаря enum', { kind: 'record', key: { kind: 'enum', values: ['a'] }, value: S }, 'ok'],
  ['ключ словаря template', { kind: 'record', key: { kind: 'template', pattern: '^a' }, value: S }, 'ok'],
  ['ключ словаря number', { kind: 'record', key: { kind: 'number' }, value: S }, 'ok'],
  ['ключ словаря union', { kind: 'record', key: { kind: 'union', options: [S] }, value: S }, 'ok'],
  ['ключ словаря opaque', { kind: 'record', key: { kind: 'opaque', reason: 'r', upper: S }, value: S }, 'ok'],
  [
    'ключ словаря boolean',
    { kind: 'record', key: { kind: 'boolean' }, value: S },
    'SnapshotFormatError: peer: не снимок контрактов: (корень): ключ словаря вида «boolean»: ключ JSON — строка',
  ],
  ['кортеж без rest', { kind: 'tuple', items: [S] }, 'ok'],
  [
    'кортеж с rest не формой',
    { kind: 'tuple', items: [S], rest: 1 },
    'SnapshotFormatError: peer: не снимок контрактов: [...]: форма — не объект',
  ],
];

describe('assertShape: точные итоги', () => {
  it.each(CASES)('%s', (_name, shape, expected) => {
    let result: string;
    try {
      assertShape(shape, 'peer', '');
      result = 'ok';
    } catch (error) {
      result = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    expect(result).toBe(expected);
  });
});
