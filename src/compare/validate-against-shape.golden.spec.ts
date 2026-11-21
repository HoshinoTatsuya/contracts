import type { PayloadIssue } from '../types/payload-issue.type';
import type { Shape } from '../types/shape.type';
import { validateAgainstShape } from './validate-against-shape';

/**
 * «Золотая» таблица: точный итог (код, путь, ТЕКСТ) на каждый случай. Ожидания записаны
 * генератором с собранного пакета и прочитаны глазами; изменение поведения или текста находки
 * обязано менять эту таблицу осознанно.
 */

const CASES: ReadonlyArray<
  readonly [string, Shape, readonly unknown[], ReadonlyArray<readonly PayloadIssue[]>]
> = [
  [
    'строка: длина и шаблон',
    { kind: 'string', minLength: 2, maxLength: 3, patterns: ['/^a/i'] },
    ['A', 'abcd', 'b', 'Ab', 7],
    [
      [{ path: '', message: 'короче 2' }],
      [{ path: '', message: 'длиннее 3' }],
      [{ path: '', message: 'короче 2; не проходит /^a/i' }],
      [],
      [{ path: '', message: 'ожидалось строка, пришло 7' }],
    ],
  ],
  [
    'число: все ограничения',
    {
      kind: 'number',
      integer: true,
      minimum: 0,
      exclusiveMinimum: 1,
      maximum: 10,
      exclusiveMaximum: 9,
      multipleOf: 2,
    },
    [-1, 1, 1.5, 9, 11, 3, 4, 'x', Number.NaN, Number.POSITIVE_INFINITY],
    [
      [{ path: '', message: 'должно быть больше 1; не кратно 2' }],
      [{ path: '', message: 'должно быть больше 1; не кратно 2' }],
      [{ path: '', message: 'не целое; не кратно 2' }],
      [{ path: '', message: 'должно быть меньше 9; не кратно 2' }],
      [{ path: '', message: 'должно быть меньше 9; не кратно 2' }],
      [{ path: '', message: 'не кратно 2' }],
      [],
      [{ path: '', message: 'ожидалось целое, пришло "x"' }],
      [{ path: '', message: 'ожидалось целое, пришло NaN' }],
      [{ path: '', message: 'ожидалось целое, пришло Infinity' }],
    ],
  ],
  [
    'простые виды',
    { kind: 'boolean' },
    [true, 'true'],
    [[], [{ path: '', message: 'ожидалось булево, пришло "true"' }]],
  ],
  ['null', { kind: 'null' }, [null, 0], [[], [{ path: '', message: 'ожидалось null, пришло 0' }]]],
  [
    'undefined',
    { kind: 'undefined' },
    [undefined, null],
    [[], [{ path: '', message: 'ожидалось undefined, пришло null' }]],
  ],
  [
    'enum',
    { kind: 'enum', values: ['a'] },
    ['a', 'b', 1],
    [
      [],
      [{ path: '', message: 'ожидалось строка «a», пришло "b"' }],
      [{ path: '', message: 'ожидалось строка «a», пришло 1' }],
    ],
  ],
  [
    'литерал',
    { kind: 'literal', value: 1 },
    [1, 2],
    [[], [{ path: '', message: 'ожидалось литерал 1, пришло 2' }]],
  ],
  [
    'шаблон',
    { kind: 'template', pattern: '^lock:' },
    ['lock:1', 'x', 1],
    [
      [],
      [{ path: '', message: 'ожидалось строка по шаблону /^lock:/, пришло "x"' }],
      [{ path: '', message: 'ожидалось строка по шаблону /^lock:/, пришло 1' }],
    ],
  ],
  [
    'шаблон, который не компилируется',
    { kind: 'template', pattern: '(' },
    ['('],
    [[{ path: '', message: 'ожидалось строка по шаблону /(/, пришло "("' }]],
  ],
  ['unknown', { kind: 'unknown' }, [1, null], [[], []]],
  ['never', { kind: 'never' }, [1], [[{ path: '', message: 'значение здесь не допускается' }]]],
  [
    'opaque: вне и внутри upper',
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    ['x', 1],
    [[], [{ path: '', message: 'ожидалось строка, пришло 1' }]],
  ],
  [
    'Date — только экземпляр',
    { kind: 'date' },
    ['2020-01-01T00:00:00.000Z'],
    [[{ path: '', message: 'ожидалось дата, пришло "2020-01-01T00:00:00.000Z"' }]],
  ],
  ['bigint', { kind: 'bigint' }, [1], [[{ path: '', message: 'ожидалось bigint, пришло 1' }]]],
  [
    'объект: обязательное, необязательное, вложенное',
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: true, shape: { kind: 'number' } },
        c: {
          optional: true,
          shape: {
            kind: 'object',
            fields: { d: { optional: false, shape: { kind: 'boolean' } } },
            unknownKeys: 'strip',
          },
        },
      },
      unknownKeys: 'strip',
    },
    [{}, { a: 'x', b: 'y' }, { a: 'x', c: { d: 1 } }, [], null, 'x', { a: 'x', b: undefined }],
    [
      [{ path: 'a', message: 'нет обязательного поля' }],
      [{ path: 'b', message: 'ожидалось число, пришло "y"' }],
      [{ path: 'c.d', message: 'ожидалось булево, пришло 1' }],
      [{ path: '', message: 'ожидалось объект {a, b, c}, пришло []' }],
      [{ path: '', message: 'ожидалось объект {a, b, c}, пришло null' }],
      [{ path: '', message: 'ожидалось объект {a, b, c}, пришло "x"' }],
      [],
    ],
  ],
  [
    'объект: строгий',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'reject' },
    [{ a: 'x', z: 1, u: undefined }],
    [[{ path: 'z', message: 'поле, которого строгий объект не знает' }]],
  ],
  [
    'объект: keep с rest',
    {
      kind: 'object',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
      unknownKeys: 'keep',
      rest: { kind: 'number' },
    },
    [{ a: 'x', z: 'y', w: 1 }],
    [[{ path: 'z', message: 'ожидалось число, пришло "y"' }]],
  ],
  ['объект: keep без rest', { kind: 'object', fields: {}, unknownKeys: 'keep' }, [{ z: 'y' }], [[]]],
  [
    'словарь',
    { kind: 'record', key: { kind: 'string', minLength: 2 }, value: { kind: 'number' } },
    [{ ab: 1, c: 'x' }, [], null],
    [
      [
        { path: 'c{key}', message: 'короче 2' },
        { path: 'c', message: 'ожидалось число, пришло "x"' },
      ],
      [{ path: '', message: 'ожидалось словарь число, пришло []' }],
      [{ path: '', message: 'ожидалось словарь число, пришло null' }],
    ],
  ],
  [
    'массив',
    { kind: 'array', element: { kind: 'number' }, minItems: 1, maxItems: 2 },
    [[], [1, 'x', 3], 'x'],
    [
      [{ path: '', message: 'элементов 0, допустимо [1, 2]' }],
      [
        { path: '', message: 'элементов 3, допустимо [1, 2]' },
        { path: '[1]', message: 'ожидалось число, пришло "x"' },
      ],
      [{ path: '', message: 'ожидалось массив число, пришло "x"' }],
    ],
  ],
  [
    'кортеж',
    {
      kind: 'tuple',
      items: [{ kind: 'number' }, { kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] }],
    },
    [[1], [1, 'a', 3], [1, 2], 'x'],
    [
      [],
      [{ path: '', message: 'элементов 3, кортеж из 2' }],
      [{ path: '[1]', message: 'ожидалось строка | undefined, пришло 2' }],
      [{ path: '', message: 'ожидалось кортеж из 2, пришло "x"' }],
    ],
  ],
  [
    'кортеж с хвостом',
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'string' } },
    [[1, 'a', 'b', 3]],
    [[{ path: '[3]', message: 'ожидалось строка, пришло 3' }]],
  ],
  [
    'объединение объектов: ближайший вариант',
    {
      kind: 'union',
      options: [
        {
          kind: 'object',
          fields: {
            a: { optional: false, shape: { kind: 'string' } },
            b: { optional: false, shape: { kind: 'string' } },
          },
          unknownKeys: 'strip',
        },
        {
          kind: 'object',
          fields: { c: { optional: false, shape: { kind: 'string' } } },
          unknownKeys: 'strip',
        },
      ],
    },
    [{ a: 'x' }, 1],
    [
      [{ path: 'b', message: 'нет обязательного поля' }],
      [{ path: '', message: 'ожидалось объект {a, b} | объект {c}, пришло 1' }],
    ],
  ],
  [
    'объединение примитивов',
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'number' }] },
    [true],
    [[{ path: '', message: 'ожидалось число | строка, пришло true' }]],
  ],
];

describe('validateAgainstShape: точные отклонения', () => {
  it.each(CASES)('%s', (_name, shape, values, expected) => {
    expect(values.map((value) => validateAgainstShape(value, shape))).toEqual(expected);
  });

  it('Date-экземпляр принимается', () => {
    expect(validateAgainstShape(new Date(0), { kind: 'date' })).toEqual([]);
  });

  it('bigint принимается', () => {
    expect(validateAgainstShape(BigInt(1), { kind: 'bigint' })).toEqual([]);
  });
});
