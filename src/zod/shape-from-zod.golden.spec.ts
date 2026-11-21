import { z } from 'zod';

import type { Shape } from '../types/shape.type';
import { shapeFromZod } from './shape-from-zod';

/**
 * «Золотая» таблица: точный итог (код, путь, ТЕКСТ) на каждый случай. Ожидания записаны
 * генератором с собранного пакета и прочитаны глазами; изменение поведения или текста находки
 * обязано менять эту таблицу осознанно.
 */

const CASES: ReadonlyArray<readonly [string, () => z.ZodType, Shape]> = [
  [
    'строка: длины складываются',
    () => z.string().min(1).min(3).max(9).max(5).length(4),
    // zod 4.6+ считает длину кодовыми точками — это часть формы.
    { kind: 'string', minLength: 4, maxLength: 4, codePoints: true },
  ],
  [
    'строка: форматы и шаблоны',
    () => z.string().regex(/a/gi).startsWith('p').endsWith('s').includes('m', { position: 2 }).lowercase(),
    {
      kind: 'string',
      patterns: ['/a/i'],
      formats: [
        'ends_with{"pattern":"/.*s$/","suffix":"s"}',
        'includes{"includes":"m","pattern":"/^.{2,}m/","position":2}',
        'lowercase{"pattern":"/^[^A-Z]*$/"}',
        'starts_with{"pattern":"/^p.*/","prefix":"p"}',
      ],
    },
  ],
  [
    'строка: overwrite без проверок после — приём прежний, выход нормализован',
    () => z.string().min(2).trim(),
    {
      kind: 'opaque',
      reason: 'trim',
      exact: true,
      semantics: 'после ["trim"]',
      upper: { kind: 'string', minLength: 2, codePoints: true },
    },
  ],
  [
    'строка: длина после trim — точный шаблон на вход',
    () => z.string().trim().min(2),
    {
      kind: 'opaque',
      reason: 'trim',
      exact: true,
      semantics: 'после ["trim","{\\"codePoints\\":true,\\"kind\\":\\"string\\",\\"minLength\\":2}"]',
      upper: { kind: 'string', patterns: ['/^\\s*\\S[\\s\\S]{0,}\\S\\s*$/u'] },
    },
  ],
  [
    'строка: проверка после своей overwrite — не на вход',
    () =>
      z
        .string()
        .overwrite((value) => value)
        .min(2),
    { kind: 'opaque', reason: 'проверка после overwrite', upper: { kind: 'string' } },
  ],
  [
    'строка: refine',
    () => z.string().refine((value) => value.length > 0),
    { kind: 'opaque', reason: 'refine', upper: { kind: 'string' } },
  ],
  [
    'число: границы',
    () => z.number().gt(1).gte(2).lt(9).lte(8).multipleOf(2).multipleOf(4),
    { kind: 'number', minimum: 2, maximum: 8, multipleOf: 4 },
  ],
  [
    'число: несовместимые кратности',
    () => z.number().multipleOf(2).multipleOf(3),
    { kind: 'opaque', reason: 'несколько multipleOf', upper: { kind: 'number', multipleOf: 2 } },
  ],
  [
    'число: int32, uint32, float64, safeint',
    () => z.object({ a: z.int32(), b: z.uint32(), c: z.float64(), d: z.int() }),
    {
      kind: 'object',
      fields: {
        a: {
          optional: false,
          shape: { kind: 'number', integer: true, minimum: -2147483648, maximum: 2147483647 },
        },
        b: { optional: false, shape: { kind: 'number', integer: true, minimum: 0, maximum: 4294967295 } },
        c: { optional: false, shape: { kind: 'number' } },
        d: {
          optional: false,
          shape: { kind: 'number', integer: true, minimum: -9007199254740991, maximum: 9007199254740991 },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'число: проверка после overwrite',
    () =>
      z
        .number()
        .overwrite((value) => value)
        .min(1),
    { kind: 'opaque', reason: 'проверка после overwrite', upper: { kind: 'number' } },
  ],
  [
    'число: refine',
    () => z.number().refine((value) => value > 0),
    { kind: 'opaque', reason: 'refine', upper: { kind: 'number' } },
  ],
  [
    'массив: длины',
    () => z.array(z.string()).min(1).max(5).length(3),
    { kind: 'array', element: { kind: 'string' }, minItems: 3, maxItems: 3 },
  ],
  [
    'массив: refine и overwrite',
    () =>
      z
        .array(z.string())
        .refine(() => true)
        .overwrite((value) => value)
        .min(1),
    {
      kind: 'opaque',
      reason: 'проверка после overwrite; refine',
      upper: { kind: 'array', element: { kind: 'string' } },
    },
  ],
  [
    'boolean, bigint, date, null, undefined, void, any, never',
    () =>
      z.object({
        b: z.boolean(),
        i: z.bigint(),
        d: z.date(),
        n: z.null(),
        u: z.undefined().optional(),
        v: z.void().optional(),
        a: z.any(),
        x: z.never().optional(),
      }),
    {
      kind: 'object',
      fields: {
        // zod 4.4+: any обязателен, но явное undefined принимает — писатель вправе его положить.
        a: { optional: false, undefinedAccepted: true, shape: { kind: 'unknown' } },
        b: { optional: false, shape: { kind: 'boolean' } },
        d: { optional: false, shape: { kind: 'date' } },
        i: { optional: false, shape: { kind: 'bigint' } },
        n: { optional: false, shape: { kind: 'null' } },
        u: { optional: true, shape: { kind: 'never' } },
        v: { optional: true, shape: { kind: 'never' } },
        x: { optional: true, shape: { kind: 'never' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'литералы',
    () => z.literal(['a', 1, true, null]),
    {
      kind: 'union',
      options: [
        { kind: 'enum', values: ['a'] },
        { kind: 'literal', value: 1 },
        { kind: 'literal', value: true },
        { kind: 'null' },
      ],
    },
  ],
  ['nativeEnum строковый', () => z.enum({ A: 'a', B: 'b' }), { kind: 'enum', values: ['a', 'b'] }],
  [
    'шаблонный литерал',
    () => z.templateLiteral(['id-', z.number()]),
    { kind: 'template', pattern: '^id--?\\d+(?:\\.\\d+)?$' },
  ],
  [
    'объект: catchall и strict',
    () => z.object({ a: z.object({}).catchall(z.number()), b: z.strictObject({}), c: z.looseObject({}) }),
    {
      kind: 'object',
      fields: {
        a: {
          optional: false,
          shape: { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'number' } },
        },
        b: { optional: false, shape: { kind: 'object', fields: {}, unknownKeys: 'reject' } },
        c: {
          optional: false,
          shape: { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'unknown' } },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'словарь и partialRecord',
    () =>
      z.object({
        r: z.record(z.string(), z.number()),
        p: z.partialRecord(z.enum(['a', 'b']), z.number()),
        l: z.looseRecord(z.enum(['a']), z.number()),
      }),
    {
      kind: 'object',
      fields: {
        l: {
          optional: false,
          shape: {
            kind: 'object',
            fields: { a: { optional: false, shape: { kind: 'number' } } },
            unknownKeys: 'keep',
            rest: { kind: 'unknown' },
          },
        },
        p: {
          optional: false,
          shape: {
            kind: 'object',
            fields: {
              a: { optional: true, shape: { kind: 'number' } },
              b: { optional: true, shape: { kind: 'number' } },
            },
            unknownKeys: 'reject',
          },
        },
        r: { optional: false, shape: { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'кортеж с хвостом',
    () => z.tuple([z.string(), z.number().optional()], z.boolean()),
    {
      kind: 'tuple',
      items: [{ kind: 'string' }, { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] }],
      rest: { kind: 'boolean' },
    },
  ],
  [
    'объединение и xor',
    () =>
      z.object({
        u: z.union([z.string(), z.number()]),
        x: z.xor([z.string(), z.number()]),
        y: z.xor([z.string(), z.string().min(1)]),
      }),
    {
      kind: 'object',
      fields: {
        u: { optional: false, shape: { kind: 'union', options: [{ kind: 'number' }, { kind: 'string' }] } },
        x: { optional: false, shape: { kind: 'union', options: [{ kind: 'number' }, { kind: 'string' }] } },
        y: {
          optional: false,
          shape: {
            kind: 'opaque',
            reason: 'xor: варианты пересекаются',
            upper: { kind: 'union', options: [{ kind: 'string', minLength: 1 }, { kind: 'string' }] },
          },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'пересечение строгих полей',
    () => z.intersection(z.object({ a: z.string() }), z.object({ a: z.string(), b: z.number().optional() })),
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: true, shape: { kind: 'number' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'пересечение keep и strip',
    () => z.intersection(z.looseObject({ a: z.string() }), z.object({ b: z.number() })),
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: false, shape: { kind: 'number' } },
      },
      unknownKeys: 'keep',
      rest: { kind: 'unknown' },
    },
  ],
  [
    'пересечение одинаковых catchall',
    () => z.intersection(z.object({}).catchall(z.number()), z.object({}).catchall(z.number())),
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'number' } },
  ],
  [
    'nullable, nonoptional, readonly, prefault',
    () =>
      z.object({
        n: z.string().nullable(),
        o: z.string().optional().nonoptional(),
        r: z.string().readonly(),
        p: z.string().prefault('x'),
      }),
    {
      kind: 'object',
      fields: {
        n: { optional: false, shape: { kind: 'union', options: [{ kind: 'null' }, { kind: 'string' }] } },
        o: { optional: false, shape: { kind: 'string' } },
        p: {
          optional: true,
          shape: {
            kind: 'opaque',
            reason: 'prefault "x"',
            exact: true,
            semantics: 'prefault "x"',
            upper: { kind: 'string' },
          },
        },
        r: { optional: false, shape: { kind: 'string' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'catch, transform, preprocess, pipe',
    () =>
      z.object({
        c: z.number().catch(0),
        t: z.transform((value) => value),
        p: z.preprocess((value) => value, z.string()),
        q: z.string().pipe(z.string().max(3)),
        n: z.number().pipe(z.number().gte(1).int()),
        w: z.string().pipe(z.any().pipe(z.number())),
        x: z.string().pipe(z.any()),
        m: z.number().multipleOf(2).pipe(z.number().multipleOf(3)),
        s: z.stringbool(),
      }),
    {
      kind: 'object',
      fields: {
        c: {
          optional: true,
          shape: {
            kind: 'opaque',
            reason: 'catch: значение вне схемы молча заменяется запасным',
            upper: { kind: 'unknown' },
            lower: { kind: 'number' },
          },
        },
        m: {
          optional: false,
          shape: { kind: 'opaque', reason: 'pipe', upper: { kind: 'number', multipleOf: 2 } },
        },
        n: {
          optional: false,
          shape: { kind: 'number', integer: true, minimum: 1, maximum: 9007199254740991 },
        },
        p: { optional: false, shape: { kind: 'opaque', reason: 'preprocess', upper: { kind: 'unknown' } } },
        q: { optional: false, shape: { kind: 'string', maxLength: 3, codePoints: true } },
        s: {
          optional: false,
          shape: {
            kind: 'opaque',
            reason: 'кодек (stringbool, codec): вход преобразуется перед выходной схемой',
            upper: { kind: 'string' },
          },
        },
        t: { optional: true, shape: { kind: 'opaque', reason: 'transform', upper: { kind: 'unknown' } } },
        w: { optional: false, shape: { kind: 'opaque', reason: 'pipe', upper: { kind: 'string' } } },
        x: { optional: false, shape: { kind: 'string' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'coerce',
    () =>
      z.object({
        n: z.coerce.number().min(1),
        s: z.coerce.string(),
        b: z.coerce.boolean(),
        i: z.coerce.bigint(),
        d: z.coerce.date(),
        r: z.coerce.number().refine(() => true),
      }),
    {
      kind: 'object',
      fields: {
        b: {
          optional: false,
          undefinedAccepted: true,
          shape: {
            kind: 'opaque',
            reason: 'coerce',
            upper: { kind: 'unknown' },
            lower: { kind: 'boolean' },
            semantics: 'coerce boolean {"kind":"boolean"}',
          },
        },
        d: {
          optional: false,
          shape: {
            kind: 'opaque',
            reason: 'coerce',
            upper: { kind: 'unknown' },
            lower: { kind: 'string', formats: ['toISOString'] },
            semantics: 'coerce date {"kind":"date"}',
          },
        },
        i: {
          optional: false,
          shape: {
            kind: 'opaque',
            reason: 'coerce',
            upper: { kind: 'unknown' },
            lower: { kind: 'bigint' },
            semantics: 'coerce bigint {"kind":"bigint"}',
          },
        },
        n: {
          optional: false,
          shape: {
            kind: 'opaque',
            reason: 'coerce',
            upper: { kind: 'unknown' },
            lower: { kind: 'number', minimum: 1 },
            semantics: 'coerce number {"kind":"number","minimum":1}',
          },
        },
        r: { optional: false, shape: { kind: 'opaque', reason: 'coerce', upper: { kind: 'unknown' } } },
        s: {
          optional: false,
          undefinedAccepted: true,
          shape: {
            kind: 'opaque',
            reason: 'coerce',
            upper: { kind: 'unknown' },
            lower: { kind: 'string' },
            semantics: 'coerce string {"kind":"string"}',
          },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'refine объекта и объединения',
    () => z.object({ a: z.union([z.string(), z.number()]).refine(() => true) }).refine(() => true),
    {
      kind: 'opaque',
      reason: 'refine',
      upper: {
        kind: 'object',
        fields: {
          a: {
            optional: false,
            shape: {
              kind: 'opaque',
              reason: 'refine',
              upper: { kind: 'union', options: [{ kind: 'number' }, { kind: 'string' }] },
            },
          },
        },
        unknownKeys: 'strip',
      },
    },
  ],
  [
    'lazy',
    () => z.object({ l: z.lazy(() => z.string()) }),
    { kind: 'object', fields: { l: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
  ],
  [
    'формат с функцией',
    () => z.stringFormat('even', (value) => value.length % 2 === 0),
    {
      kind: 'opaque',
      reason: 'формат «even» проверяется функцией',
      upper: { kind: 'string', formats: ['even'] },
    },
  ],
];

describe('shapeFromZod: точные формы', () => {
  it.each(CASES)('%s', (_name, schema, expected) => {
    expect(shapeFromZod(schema(), 'c')).toEqual(expected);
  });
});
