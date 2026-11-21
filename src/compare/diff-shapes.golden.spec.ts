import type { Shape } from '../types/shape.type';
import { diffShapes } from './diff-shapes';

/**
 * «Золотая» таблица: точный итог (код, путь, ТЕКСТ) на каждый случай. Ожидания записаны
 * генератором с собранного пакета и прочитаны глазами; изменение поведения или текста находки
 * обязано менять эту таблицу осознанно.
 */

const CASES: ReadonlyArray<readonly [string, Shape, Shape, readonly string[]]> = [
  [
    'одинаковые',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    [],
  ],
  ['вид', { kind: 'string' }, { kind: 'number' }, ['mirror-difference  — корень: A строка, B число']],
  [
    'поля и обязательность',
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: true, shape: { kind: 'number' } },
      },
      unknownKeys: 'strip',
    },
    {
      kind: 'object',
      fields: {
        a: { optional: true, shape: { kind: 'string' } },
        c: { optional: false, shape: { kind: 'boolean' } },
      },
      unknownKeys: 'strip',
    },
    [
      'mirror-difference b — «b»: поле есть A, нет B',
      'mirror-difference c — «c»: поле есть B, нет A',
      'mirror-difference a — «a»: A обязательное, B необязательное',
    ],
  ],
  [
    'политика лишних полей',
    { kind: 'object', fields: {}, unknownKeys: 'strip' },
    { kind: 'object', fields: {}, unknownKeys: 'reject' },
    ['mirror-difference  — корень: неизвестные поля A выбрасывает, B отвергает'],
  ],
  [
    'политика keep и rest',
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'number' } },
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'string' } },
    ['mirror-difference {*} — «{*}»: A число, B строка'],
  ],
  [
    'enum',
    { kind: 'enum', values: ['a', 'b'] },
    { kind: 'enum', values: ['b', 'c'] },
    [
      'mirror-difference  — корень: строки на проводе только A: «a»',
      'mirror-difference  — корень: строки на проводе только B: «c»',
    ],
  ],
  [
    'массив',
    { kind: 'array', element: { kind: 'number' }, minItems: 1 },
    { kind: 'array', element: { kind: 'string' }, maxItems: 3 },
    [
      'mirror-difference  — корень: границы длины A [1, ∞], B [0, 3]',
      'mirror-difference [] — «[]»: A число, B строка',
    ],
  ],
  [
    'словарь',
    { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } },
    { kind: 'record', key: { kind: 'string', minLength: 1 }, value: { kind: 'string' } },
    [
      'mirror-difference {key} — «{key}»: ограничения A {}, B {"minLength":1}',
      'mirror-difference {*} — «{*}»: A число, B строка',
    ],
  ],
  [
    'кортеж: длина и хвост',
    { kind: 'tuple', items: [{ kind: 'number' }, { kind: 'string' }], rest: { kind: 'boolean' } },
    { kind: 'tuple', items: [{ kind: 'number' }] },
    [
      'mirror-difference  — корень: кортеж A из 2, B из 1',
      'mirror-difference  — корень: хвост кортежа A, нет B',
    ],
  ],
  [
    'кортеж: хвост с другой стороны',
    { kind: 'tuple', items: [{ kind: 'number' }] },
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'boolean' } },
    ['mirror-difference  — корень: хвост кортежа B, нет A'],
  ],
  [
    'кортеж: хвосты различаются',
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'boolean' } },
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'string' } },
    ['mirror-difference [...] — «[...]»: A булево, B строка'],
  ],
  [
    'объединение: один вариант того же вида',
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'number', minimum: 1 }] },
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'number' }] },
    ['mirror-difference  — корень: ограничения A {"minimum":1}, B {}'],
  ],
  [
    'объединение: варианты разного вида',
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'number' }] },
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'boolean' }] },
    [
      'mirror-difference  — корень: вариант число есть A, нет B',
      'mirror-difference  — корень: вариант булево есть B, нет A',
    ],
  ],
  [
    'объединение: два варианта',
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'number' }, { kind: 'boolean' }] },
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'null' }, { kind: 'literal', value: 1 }] },
    [
      'mirror-difference  — корень: вариант булево есть A, нет B',
      'mirror-difference  — корень: вариант число есть A, нет B',
      'mirror-difference  — корень: вариант литерал 1 есть B, нет A',
      'mirror-difference  — корень: вариант null есть B, нет A',
    ],
  ],
  [
    'ограничения числа',
    { kind: 'number', minimum: 1 },
    { kind: 'number', minimum: 2 },
    ['mirror-difference  — корень: ограничения A {"minimum":1}, B {"minimum":2}'],
  ],
  [
    'непрозрачный: граница и lower (текст причины не сравнивается)',
    {
      kind: 'opaque',
      reason: 'transform',
      upper: { kind: 'string' },
      lower: { kind: 'enum', values: ['a'] },
    },
    { kind: 'opaque', reason: 'refine', upper: { kind: 'number' } },
    [
      'mirror-difference  — корень: A строка, B число',
      'mirror-difference  — корень: принято наверняка A строка «a», B ничего',
      'not-proven  — корень: строка (transform) — совпадение копий не доказывает, что семантика вне формы одна и та же',
      'not-proven  — корень: число (refine) — совпадение копий не доказывает, что семантика вне формы одна и та же',
    ],
  ],
  [
    'непрозрачный: поведение описано (semantics) — сравнивается оно',
    { kind: 'opaque', reason: 'default', exact: true, semantics: 'default "low"', upper: { kind: 'string' } },
    {
      kind: 'opaque',
      reason: 'default',
      exact: true,
      semantics: 'default "high"',
      upper: { kind: 'string' },
    },
    ['mirror-difference  — корень: поведение A «default "low"», B «default "high"»'],
  ],
  [
    'непрозрачный против того же',
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    [
      'not-proven  — корень: строка (transform) — совпадение копий не доказывает, что семантика вне формы одна и та же',
    ],
  ],
  [
    'непрозрачный внутри объекта, массива, словаря, кортежа и rest',
    {
      kind: 'object',
      fields: {
        a: {
          optional: false,
          shape: { kind: 'array', element: { kind: 'opaque', reason: 'refine', upper: { kind: 'string' } } },
        },
        r: {
          optional: false,
          shape: {
            kind: 'record',
            key: { kind: 'string' },
            value: { kind: 'opaque', reason: 'refine', upper: { kind: 'number' } },
          },
        },
        t: {
          optional: false,
          shape: {
            kind: 'tuple',
            items: [{ kind: 'opaque', reason: 'x', upper: { kind: 'string' } }],
            rest: { kind: 'opaque', reason: 'y', upper: { kind: 'string' } },
          },
        },
      },
      unknownKeys: 'keep',
      rest: { kind: 'opaque', reason: 'z', upper: { kind: 'string' } },
    },
    {
      kind: 'object',
      fields: {
        a: {
          optional: false,
          shape: { kind: 'array', element: { kind: 'opaque', reason: 'refine', upper: { kind: 'string' } } },
        },
        r: {
          optional: false,
          shape: {
            kind: 'record',
            key: { kind: 'string' },
            value: { kind: 'opaque', reason: 'refine', upper: { kind: 'number' } },
          },
        },
        t: {
          optional: false,
          shape: {
            kind: 'tuple',
            items: [{ kind: 'opaque', reason: 'x', upper: { kind: 'string' } }],
            rest: { kind: 'opaque', reason: 'y', upper: { kind: 'string' } },
          },
        },
      },
      unknownKeys: 'keep',
      rest: { kind: 'opaque', reason: 'z', upper: { kind: 'string' } },
    },
    [
      'not-proven a[] — «a[]»: строка (refine) — совпадение копий не доказывает, что семантика вне формы одна и та же',
      'not-proven r{*} — «r{*}»: число (refine) — совпадение копий не доказывает, что семантика вне формы одна и та же',
      'not-proven t[0] — «t[0]»: строка (x) — совпадение копий не доказывает, что семантика вне формы одна и та же',
      'not-proven t[...] — «t[...]»: строка (y) — совпадение копий не доказывает, что семантика вне формы одна и та же',
      'not-proven {*} — «{*}»: строка (z) — совпадение копий не доказывает, что семантика вне формы одна и та же',
    ],
  ],
  [
    'Date, bigint, undefined в массиве и кортеже',
    {
      kind: 'object',
      fields: {
        d: { optional: false, shape: { kind: 'date' } },
        b: { optional: false, shape: { kind: 'bigint' } },
        a: {
          optional: false,
          shape: {
            kind: 'array',
            element: { kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] },
          },
        },
        t: {
          optional: false,
          shape: {
            kind: 'tuple',
            items: [{ kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] }],
            rest: { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] },
          },
        },
      },
      unknownKeys: 'strip',
    },
    {
      kind: 'object',
      fields: {
        d: { optional: false, shape: { kind: 'date' } },
        b: { optional: false, shape: { kind: 'bigint' } },
        a: {
          optional: false,
          shape: {
            kind: 'array',
            element: { kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] },
          },
        },
        t: {
          optional: false,
          shape: {
            kind: 'tuple',
            items: [{ kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] }],
            rest: { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] },
          },
        },
      },
      unknownKeys: 'strip',
    },
    [
      'json-lossy a[] — «a[]»: undefined в массиве по JSON едет как null',
      'json-lossy b — «b»: bigint не переживает JSON',
      'json-lossy d — «d»: дата не переживает JSON',
      'json-lossy t[0] — «t[0]»: undefined в массиве по JSON едет как null',
      'json-lossy t[...] — «t[...]»: undefined в массиве по JSON едет как null',
    ],
  ],
  [
    'undefined вне массива — не потеря',
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] },
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] },
    [],
  ],
];

describe('diffShapes: точные находки', () => {
  it.each(CASES)('%s', (_name, a, b, expected) => {
    expect(
      diffShapes(a, b, { contract: 'c', labels: ['A', 'B'] }).map(
        (finding) => `${finding.code} ${finding.path} — ${finding.message}`,
      ),
    ).toEqual(expected);
  });

  it('подписи сторон по умолчанию — «здесь» и «там»', () => {
    expect(diffShapes({ kind: 'string' }, { kind: 'number' }, { contract: 'c' })[0]?.message).toBe(
      'корень: здесь строка, там число',
    );
  });
});
