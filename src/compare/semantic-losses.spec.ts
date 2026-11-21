import { z } from 'zod';

import { shapeFromZod } from '../zod/shape-from-zod';
import { compareShapes } from './compare-shapes';
import { diffShapes } from './diff-shapes';

/**
 * Дифференциальная сверка вердикта с настоящим разбором: у каждой строки есть
 * payload, который писатель ПРИНИМАЕТ, а читатель после JSON — ОТВЕРГАЕТ.
 * Значит, «совместимо» про эту пару — ложь, и вердикт обязан быть красным
 * (нарушение или «не доказано») во всех режимах, включая зеркало. Сначала
 * проверяется сама фикстура: без запрещённого случая строка ничего бы не
 * доказывала.
 */
interface Row {
  readonly name: string;
  readonly writer: z.ZodType;
  readonly reader: z.ZodType;
  readonly payload: unknown;
}

const o = z.object;
const json = (value: unknown): unknown => {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : JSON.parse(text);
};
const red = (outcome: unknown): boolean => {
  const { violations, unproven } = outcome as {
    readonly violations: readonly unknown[];
    readonly unproven?: readonly unknown[];
  };
  return violations.length + (unproven?.length ?? 0) > 0;
};
const green = (outcome: unknown): boolean => {
  const { violations, unproven } = outcome as {
    readonly violations: readonly unknown[];
    readonly unproven?: readonly unknown[];
  };
  return violations.length === 0 && (unproven?.length ?? 0) === 0;
};
const verdicts = (writer: z.ZodType, reader: z.ZodType) => {
  const w = shapeFromZod(writer, 'w');
  const r = shapeFromZod(reader, 'r');
  return {
    compatible: red(compareShapes(w, r, { contract: 'c', mode: 'compatible' })),
    aligned: red(compareShapes(w, r, { contract: 'c', mode: 'aligned' })),
    mirror: diffShapes(w, r, { contract: 'c' }).length > 0,
  };
};
const NativeNumeric = { A: 0, B: 1, 0: 'A', 1: 'B' } as const;

const ROWS: readonly Row[] = [
  // F1: coerce/preprocess у читателя — не «принимает что угодно».
  {
    name: 'preprocess у читателя',
    writer: z.number(),
    reader: z.preprocess((v) => v, z.string()),
    payload: 5,
  },
  {
    name: 'preprocess с trim и min',
    writer: z.string(),
    reader: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
    payload: '  ',
  },
  { name: 'coerce.number против строки', writer: z.string(), reader: z.coerce.number(), payload: 'abc' },
  { name: 'coerce.number с min', writer: z.number(), reader: z.coerce.number().min(5), payload: 1 },
  { name: 'coerce.string с min', writer: z.string(), reader: z.coerce.string().min(3), payload: 'a' },
  // Писатель с coerce кладёт на провод вход как есть: строку '5', а не число.
  { name: 'coerce у писателя', writer: z.coerce.number(), reader: z.number(), payload: '5' },
  // F2: выход pipe/transform и переписывающие проверки.
  { name: 'trim, затем min', writer: z.string().min(1), reader: z.string().trim().min(1), payload: ' ' },
  {
    name: 'toLowerCase, затем regex',
    writer: z.string().regex(/^[A-Z]+$/),
    reader: z
      .string()
      .toLowerCase()
      .regex(/^[A-Z]+$/),
    payload: 'ABC',
  },
  { name: 'выход pipe с min', writer: z.string(), reader: z.string().pipe(z.string().min(5)), payload: 'ab' },
  {
    name: 'transform → pipe(int)',
    writer: z.string(),
    reader: z.string().transform(Number).pipe(z.number().int()),
    payload: 'x',
  },
  { name: 'stringbool', writer: z.string(), reader: z.stringbool(), payload: 'maybe' },
  {
    name: 'transform с addIssue',
    writer: z.string(),
    reader: z.string().transform((s, ctx) => {
      if (s === 'bad') {
        ctx.addIssue({ code: 'custom', message: 'no' });
      }
      return s;
    }),
    payload: 'bad',
  },
  {
    name: 'refine у читателя',
    writer: z.string(),
    reader: z.string().refine((s) => s !== 'x'),
    payload: 'x',
  },
  {
    name: 'refine объекта у читателя',
    writer: o({ a: z.number(), b: z.number() }),
    reader: o({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b),
    payload: { a: 2, b: 1 },
  },
  // F3: флаги regex и параметры форматов.
  {
    name: 'флаг regex i',
    writer: z.string().regex(/^[a-z]+$/i),
    reader: z.string().regex(/^[a-z]+$/),
    payload: 'ABC',
  },
  {
    name: 'флаг regex m',
    writer: z.string().regex(/^a$/m),
    reader: z.string().regex(/^a$/),
    payload: 'b\na',
  },
  { name: 'флаг regex y против enum', writer: z.enum(['ab']), reader: z.string().regex(/b/y), payload: 'ab' },
  {
    name: 'uuid против uuidv4',
    writer: z.uuid(),
    reader: z.uuidv4(),
    payload: '01890a5d-ac96-774b-bcce-b302099a8057',
  },
  {
    name: 'datetime offset',
    writer: z.iso.datetime({ offset: true }),
    reader: z.iso.datetime(),
    payload: '2020-01-01T00:00:00+02:00',
  },
  {
    name: 'datetime precision',
    writer: z.iso.datetime(),
    reader: z.iso.datetime({ precision: 0 }),
    payload: '2020-01-01T00:00:00.123Z',
  },
  {
    name: 'url protocol',
    writer: z.url(),
    reader: z.url({ protocol: /^https$/ }),
    payload: 'http://a.example',
  },
  {
    name: 'includes position',
    writer: z.string().includes('x'),
    reader: z.string().includes('x', { position: 3 }),
    payload: 'x',
  },
  {
    name: 'email со своим выражением',
    writer: z.email(),
    reader: z.email({ pattern: z.regexes.html5Email }),
    payload: 'a@b-.example',
  },
  {
    name: 'формат с функцией проверки',
    writer: z.string(),
    reader: z.stringFormat('two-plus', (value) => value.length > 1),
    payload: 'a',
  },
  { name: 'float32', writer: z.number(), reader: z.float32(), payload: 1e39 },
  { name: 'int: границы safeint', writer: z.number().multipleOf(1), reader: z.int(), payload: 2 ** 60 },
  // F4: словари.
  {
    name: 'catchall против record',
    writer: o({}).catchall(z.string()),
    reader: z.record(z.string(), z.number()),
    payload: { x: 'y' },
  },
  {
    name: 'looseObject против record',
    writer: z.looseObject({}),
    reader: z.record(z.string(), z.number()),
    payload: { x: 'y' },
  },
  {
    name: 'looseObject против record(enum)',
    writer: z.looseObject({ a: z.number() }),
    reader: z.record(z.enum(['a']), z.number()),
    payload: { a: 1, b: 2 },
  },
  {
    name: 'объект против исчерпывающего record(enum)',
    writer: o({ a: z.number() }),
    reader: z.record(z.enum(['a', 'b']), z.number()),
    payload: { a: 1 },
  },
  {
    name: 'необязательное поле против record(enum)',
    writer: o({ a: z.number().optional(), b: z.number() }),
    reader: z.record(z.enum(['a', 'b']), z.number()),
    payload: { b: 1 },
  },
  {
    name: 'record(enum) расширен у читателя',
    writer: z.record(z.enum(['a', 'b']), z.number()),
    reader: z.record(z.enum(['a', 'b', 'c']), z.number()),
    payload: { a: 1, b: 2 },
  },
  {
    name: 'partialRecord против record',
    writer: z.partialRecord(z.enum(['a', 'b']), z.number()),
    reader: z.record(z.enum(['a', 'b']), z.number()),
    payload: { a: 1 },
  },
  {
    name: 'looseRecord писателя',
    writer: z.looseRecord(z.string().regex(/^a/), z.number()),
    reader: z.record(z.string().regex(/^a/), z.number()),
    payload: { a1: 1, b: 'str' },
  },
  // Массивы: несколько ограничений длины, кортеж против массива.
  {
    name: 'min(3), затем nonempty',
    writer: z.array(z.string()).min(1),
    reader: z.array(z.string()).min(3).nonempty(),
    payload: ['a'],
  },
  {
    name: 'max(2), затем max(100)',
    writer: z.array(z.string()).max(100),
    reader: z.array(z.string()).max(2).max(100),
    payload: ['a', 'b', 'c'],
  },
  {
    name: 'кортеж против массива с min',
    writer: z.tuple([z.string()]),
    reader: z.array(z.string()).min(2),
    payload: ['a'],
  },
  {
    name: 'кортеж против массива с max',
    writer: z.tuple([z.string(), z.string(), z.string()]),
    reader: z.array(z.string()).max(2),
    payload: ['a', 'b', 'c'],
  },
  {
    name: 'max(2), затем length(3) у строки',
    writer: z.string().length(3),
    reader: z.string().max(2).length(3),
    payload: 'abc',
  },
  // Открытый писатель против необязательного поля читателя.
  {
    name: 'looseObject писателя против необязательного поля',
    writer: z.looseObject({ a: z.string() }),
    reader: o({ a: z.string(), b: z.string().optional() }),
    payload: { a: 'x', b: 1 },
  },
  {
    name: 'catchall писателя против необязательного поля',
    writer: o({ a: z.string() }).catchall(z.number()),
    reader: o({ a: z.string(), b: z.string().optional() }),
    payload: { a: 'x', b: 1 },
  },
  // F7: имена полей Object.prototype.
  {
    name: 'читатель требует constructor',
    writer: o({}),
    reader: o({ constructor: z.string() }),
    payload: {},
  },
  {
    name: 'читатель требует toString',
    writer: o({ a: z.string() }),
    reader: o({ a: z.string(), toString: z.string() }),
    payload: { a: 'x' },
  },
  {
    name: 'писатель шлёт constructor строгому читателю',
    writer: o({ constructor: z.string().optional() }),
    reader: z.strictObject({}),
    payload: { constructor: 'x' },
  },
  // F8: xor.
  {
    name: 'xor с пересекающимися вариантами',
    writer: o({ a: z.string() }),
    reader: z.xor([o({ a: z.string() }), o({ a: z.string(), b: z.number().optional() })]),
    payload: { a: 'x' },
  },
  {
    name: 'xor против union (зеркало)',
    writer: z.union([z.string(), z.string().min(1)]),
    reader: z.xor([z.string(), z.string().min(1)]),
    payload: 'abc',
  },
  // F9: числовой нативный enum.
  { name: 'числовой нативный enum', writer: z.enum(['A', 'B']), reader: z.enum(NativeNumeric), payload: 'A' },
  // F10: JSON-транспорт.
  { name: 'Date по JSON', writer: z.date(), reader: z.date(), payload: new Date(0) },
  {
    name: 'undefined в массиве по JSON',
    writer: z.array(z.string().optional()),
    reader: z.array(z.string().optional()),
    payload: ['a', undefined],
  },
  {
    name: 'undefined в кортеже по JSON',
    writer: z.tuple([z.string(), z.number().optional()]),
    reader: z.tuple([z.string(), z.number().optional()]),
    payload: ['a', undefined],
  },
  // F19: пересечение двух catchall.
  {
    name: 'пересечение двух catchall у читателя',
    writer: z.looseObject({ a: z.string() }),
    reader: o({ a: z.string() }).catchall(z.number()).and(o({}).catchall(z.number())),
    payload: { a: 'x', c: 'str' },
  },
  {
    name: 'пересечение catchall и обычного объекта у читателя',
    writer: z.looseObject({ a: z.string(), b: z.string() }),
    reader: o({ a: z.string() })
      .catchall(z.number())
      .and(o({ b: z.string() })),
    payload: { a: 'x', b: 'y', c: 's' },
  },
  // Отсутствие поля: решает сам zod, а не «в форме есть undefined».
  {
    name: 'union с undefined: отсутствие поля',
    writer: o({}),
    reader: o({ a: z.union([z.string(), z.undefined()]) }),
    payload: {},
  },
  { name: 'unknown: отсутствие поля', writer: o({}), reader: o({ a: z.unknown() }), payload: {} },
];

describe('ложно-зелёных пар нет: payload писателя, отвергнутый читателем, краснит вердикт', () => {
  it.each(ROWS.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    expect({
      writerAccepts: row.writer.safeParse(row.payload).success,
      readerAcceptsJson: row.reader.safeParse(json(row.payload)).success,
    }).toEqual({ writerAccepts: true, readerAcceptsJson: false });
    expect(verdicts(row.writer, row.reader)).toEqual({ compatible: true, aligned: true, mirror: true });
  });

  it('выборка не выродилась', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(45);
  });
});

/**
 * Обратная сторона: доказуемо совместимое остаётся зелёным. Без этих строк
 * правка «всё непонятное — красное» прошла бы любую проверку выше.
 */
describe('доказуемо совместимое — зелёное', () => {
  const PROVEN: ReadonlyArray<readonly [string, z.ZodType, z.ZodType]> = [
    [
      'coerce.number у читателя, писатель шлёт числа в его границах',
      z.number().min(6),
      z.coerce.number().min(5),
    ],
    ['coerce.string у читателя, писатель шлёт строки', z.string().min(4), z.coerce.string().min(3)],
    ['catch у читателя, писатель шлёт то, что внутренняя схема принимает', z.number(), z.number().catch(0)],
    [
      'pipe(string, string.min) у читателя — ограничения сложены',
      z.string().min(6),
      z.string().pipe(z.string().min(5)),
    ],
    ['xor с непересекающимися вариантами', z.string(), z.xor([z.string(), z.number()])],
    [
      'объект против record(enum) с теми же ключами',
      o({ a: z.number(), b: z.number() }),
      z.record(z.enum(['a', 'b']), z.number()),
    ],
    [
      'partialRecord против partialRecord',
      z.partialRecord(z.enum(['a']), z.number()),
      z.partialRecord(z.enum(['a']), z.number()),
    ],
    [
      'looseRecord у читателя принимает record писателя',
      z.record(z.string().regex(/^a/), z.number()),
      z.looseRecord(z.string().regex(/^a/), z.number()),
    ],
    ['Date писателя по JSON — строка ISO для z.coerce.date()', z.date(), z.coerce.date()],
    ['Date писателя по JSON — строка без ограничений', z.date(), z.string()],
    ['regex с одинаковыми флагами', z.string().regex(/^a/i), z.string().regex(/^a/i)],
    ['трим без проверок после него', z.string().min(2), z.string().trim()],
    ['числовой нативный enum — числа', z.union([z.literal(0), z.literal(1)]), z.enum(NativeNumeric)],
    ['refine писателя сужает то, что он шлёт', z.string().refine((s) => s.length > 0), z.string()],
    ['catch-поле читателя: писатель вправе его не класть', o({}), o({ a: z.string().catch('x') })],
  ];
  it.each(PROVEN)('%s', (_name, writer, reader) => {
    const w = shapeFromZod(writer, 'w');
    const r = shapeFromZod(reader, 'r');
    expect(green(compareShapes(w, r, { contract: 'c', mode: 'compatible' }))).toBe(true);
  });
});
