import { z } from 'zod';

import { FINDING_CODE } from '../constants/finding-code.constant';
import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import type { Shape } from '../types/shape.type';
import { shapeFromZod } from '../zod/shape-from-zod';
import { checkEvolution } from './check-evolution';
import { compareShapes } from './compare-shapes';
import { compareSnapshots } from './compare-snapshots';
import { diffShapes } from './diff-shapes';
import { validateAgainstShape } from './validate-against-shape';

/**
 * Края сверки, где вердикт расходился с настоящим разбором zod: кортежи
 * (хвост, необязательные члены, длины), дата за 9999 годом, первый
 * подошедший вариант объединения, значения словаря `undefined`, текст причины
 * непрозрачного узла, число писателя-TypeScript. Каждый «совместимо»
 * сверяется с фактом `safeParse(JSON(payload))`.
 */
type Mode = 'compatible' | 'aligned';
const outcomeOf = (writer: Shape, reader: Shape, mode: Mode = 'compatible', extra?: 'unchecked') =>
  compareShapes(writer, reader, {
    contract: 'c',
    mode,
    ...(extra === undefined ? {} : { writerExtraFields: extra }),
  });
const verdict = (writer: Shape, reader: Shape, mode: Mode = 'compatible'): string => {
  const outcome = outcomeOf(writer, reader, mode);
  return outcome.violations.length > 0
    ? 'нарушение'
    : outcome.unproven.length > 0
      ? 'не доказано'
      : 'совместимо';
};
const zodVerdict = (writer: z.ZodType, reader: z.ZodType, mode: Mode = 'compatible') =>
  verdict(shapeFromZod(writer), shapeFromZod(reader), mode);
const accepted = (schema: z.ZodType, value: unknown): boolean =>
  schema.safeParse(JSON.parse(JSON.stringify(value))).success;

describe('кортежи: длины и позиции, которые вправе прислать писатель', () => {
  it('хвост писателя против необязательного члена читателя', () => {
    const writer = z.tuple([z.string()], z.number());
    const reader = z.tuple([z.string(), z.string().optional()], z.number());
    expect(accepted(reader, ['a', 1])).toBe(false);
    expect(zodVerdict(writer, reader)).toBe('нарушение');
  });

  it('необязательный последний член писателя против обязательного у читателя', () => {
    const writer = z.tuple([z.null().optional()]);
    const reader = z.tuple([z.null()]);
    expect(writer.safeParse([]).success).toBe(true);
    expect(accepted(reader, [])).toBe(false);
    expect(zodVerdict(writer, reader)).toBe('нарушение');
  });

  it('лишний член читателя, которого писатель не шлёт, — не «совместимо» молча', () => {
    const reader = z.tuple([z.string(), z.unknown().pipe(z.boolean())]);
    expect(accepted(reader, ['a'])).toBe(false);
    expect(zodVerdict(z.tuple([z.string()]), reader)).not.toBe('совместимо');
  });

  it('контроль: необязательные члены читателя сверх длины писателя — совместимо', () => {
    const reader = z.tuple([z.string(), z.number().optional()]);
    expect(accepted(reader, ['a'])).toBe(true);
    expect(zodVerdict(z.tuple([z.string()]), reader)).toBe('совместимо');
    expect(zodVerdict(z.tuple([z.string(), z.number()]), z.tuple([z.string()], z.number()))).toBe(
      'совместимо',
    );
  });

  it('писатель длиннее, чем принимает читатель, — нарушение tuple-length', () => {
    const outcome = outcomeOf(
      shapeFromZod(z.tuple([z.string(), z.number()])),
      shapeFromZod(z.tuple([z.string()])),
    );
    expect(outcome.violations.map((finding) => finding.code)).toEqual([FINDING_CODE.tupleLength]);
  });
});

describe('дата писателя по JSON', () => {
  it('год вне 0000–9999 даёт расширенный год: против z.iso.datetime() — не «совместимо»', () => {
    const reader = z.iso.datetime();
    expect(accepted(reader, new Date(8.64e15))).toBe(false);
    expect(zodVerdict(z.date(), reader)).toBe('не доказано');
  });

  it('контроль: строка без ограничений и coerce.date принимают любую дату', () => {
    expect(zodVerdict(z.date(), z.string())).toBe('совместимо');
    expect(zodVerdict(z.date(), z.coerce.date())).toBe('совместимо');
    expect(zodVerdict(z.iso.datetime(), z.coerce.date())).toBe('совместимо');
    expect(zodVerdict(z.date(), z.string().max(10))).toBe('нарушение');
  });

  it('дата против даты (z.date) — json-lossy, в том числе в объединении с null', () => {
    const codes = (reader: z.ZodType): string[] =>
      outcomeOf(shapeFromZod(z.date()), shapeFromZod(reader)).violations.map((finding) => finding.code);
    expect(codes(z.date())).toEqual([FINDING_CODE.jsonLossy]);
    expect(codes(z.date().nullable())).toEqual([FINDING_CODE.jsonLossy]);
  });
});

describe('объединение читателя: zod отдаёт первый подошедший вариант', () => {
  const writer = z.object({ a: z.string(), b: z.number() });
  const reader = z.union([z.object({ a: z.string() }), z.object({ a: z.string(), b: z.number() })]);

  it('aligned: вариант-подмножество выбросит b — не доказано', () => {
    expect(reader.parse({ a: 'x', b: 1 })).toEqual({ a: 'x' });
    expect(zodVerdict(writer, reader, 'aligned')).toBe('не доказано');
  });

  it('compatible: то же — замечание field-unread, вердикт зелёный', () => {
    const outcome = outcomeOf(shapeFromZod(writer), shapeFromZod(reader));
    expect([outcome.violations.length, outcome.unproven.length]).toEqual([0, 0]);
    expect(outcome.notes.map((finding) => finding.code)).toContain(FINDING_CODE.fieldUnread);
  });

  it('контроль: размеченное объединение — выбор по метке, без сомнений', () => {
    const tagged = z.discriminatedUnion('t', [
      z.object({ t: z.literal('a'), x: z.string() }),
      z.object({ t: z.literal('b'), x: z.string(), y: z.number() }),
    ]);
    expect(zodVerdict(z.object({ t: z.literal('b'), x: z.string(), y: z.number() }), tagged, 'aligned')).toBe(
      'совместимо',
    );
  });
});

describe('литералы, словари, массивы и объекты против других видов', () => {
  it('литерал true против строки — type-changed (не только булево принимает true)', () => {
    expect(
      outcomeOf(shapeFromZod(z.literal(true)), shapeFromZod(z.string())).violations.map((f) => f.code),
    ).toEqual([FINDING_CODE.typeChanged]);
    expect(zodVerdict(z.literal(true), z.boolean())).toBe('совместимо');
  });

  it('словарь писателя против объекта с обязательным полем — нарушение', () => {
    const reader = z.object({ a: z.number(), b: z.number().optional() });
    expect(accepted(reader, {})).toBe(false);
    expect(zodVerdict(z.record(z.string(), z.number()), reader)).toBe('нарушение');
    expect(zodVerdict(z.record(z.string(), z.number()), z.object({ b: z.number().optional() }))).toBe(
      'совместимо',
    );
  });

  it('объект писателя против словаря: каждое поле — значением словаря', () => {
    const reader = z.record(z.string(), z.number());
    expect(accepted(reader, { a: 'x' })).toBe(false);
    expect(zodVerdict(z.object({ a: z.string() }), reader)).toBe('нарушение');
    expect(zodVerdict(z.object({ a: z.number() }), reader)).toBe('совместимо');
  });

  it('массив: писатель min(3) против читателя min(2) — совместимо, min(1) против min(2) — нарушение', () => {
    expect(zodVerdict(z.array(z.number()).min(3), z.array(z.number()).min(2))).toBe('совместимо');
    expect(zodVerdict(z.array(z.number()).min(1), z.array(z.number()).min(2))).toBe('нарушение');
  });

  it('значение словаря undefined по JSON пропадает — не нарушение', () => {
    const reader = z.record(z.string(), z.string());
    expect(accepted(reader, { a: 'x', b: undefined })).toBe(true);
    expect(zodVerdict(z.record(z.string(), z.string().optional()), reader)).toBe('совместимо');
    expect(zodVerdict(z.object({ a: z.string() }).catchall(z.string().optional()), reader)).toBe(
      'совместимо',
    );
  });
});

describe('образец писателя против формы читателя', () => {
  it('число ниже минимума читателя — отклонение с путём', () => {
    expect(validateAgainstShape({ a: 1 }, shapeFromZod(z.object({ a: z.number().min(5) })))).toEqual([
      { path: 'a', message: 'меньше 5' },
    ]);
    expect(validateAgainstShape({ a: 5 }, shapeFromZod(z.object({ a: z.number().min(5) })))).toEqual([]);
  });
});

describe('зеркало: кортежи сверяются по членам', () => {
  it('[строка] против [число] — различие на члене', () => {
    expect(
      diffShapes(shapeFromZod(z.tuple([z.string()])), shapeFromZod(z.tuple([z.number()])), {
        contract: 'c',
      }).map((finding) => `${finding.code} ${finding.path}`),
    ).toEqual(['mirror-difference [0]']);
  });
});

describe('текст причины непрозрачного узла — не изменение контракта', () => {
  const opaque = (reason: string): Shape => ({
    kind: 'object',
    unknownKeys: 'strip',
    fields: { a: { optional: false, shape: { kind: 'opaque', reason, upper: { kind: 'string' } } } },
  });
  const document = (reason: string, version = '1.0.0') => ({
    format: 'contracts-snapshot/2' as const,
    contracts: {
      c: {
        role: 'both' as const,
        version,
        versionField: 'contractVersion',
        legacyVersion: null,
        extraFields: 'refused' as const,
        shape: opaque(reason),
        wire: {},
        examples: [],
      },
    },
  });

  it('checkEvolution: другая формулировка причины — ни version-not-bumped, ни not-proven', () => {
    const verdictAfter = checkEvolution(document('кодек (stringbool)'), document('stringbool: кодек'));
    expect([verdictAfter.violations, verdictAfter.unproven]).toEqual([[], []]);
  });

  it('контроль: изменилась граница — version-not-bumped', () => {
    const changed = document('x');
    const next = {
      ...changed,
      contracts: {
        c: {
          ...changed.contracts.c,
          shape: { ...opaque('x'), unknownKeys: 'reject' as const },
        },
      },
    };
    expect(checkEvolution(changed, next).violations.map((finding) => finding.code)).toContain(
      FINDING_CODE.versionNotBumped,
    );
  });

  it('зеркало: копии отличаются только текстом причины — без mirror-difference', () => {
    expect(diffShapes(opaque('a'), opaque('b'), { contract: 'c' }).map((finding) => finding.code)).toEqual([
      'not-proven',
      'not-proven',
    ]);
  });
});

describe('писатель — тип TypeScript: number допускает NaN', () => {
  it('замечание json-lossy против читателя-числа, вердикт не портит', () => {
    const outcome = outcomeOf({ kind: 'number' }, { kind: 'number' }, 'compatible', 'unchecked');
    expect([outcome.violations.length, outcome.unproven.length]).toEqual([0, 0]);
    expect(outcome.notes.map((finding) => finding.code)).toEqual([FINDING_CODE.jsonLossy]);
    expect(outcomeOf({ kind: 'number' }, { kind: 'number' }).notes).toEqual([]);
  });
});

describe('снимки двух сторон: сверка по-прежнему адресна', () => {
  it('compareSnapshots с одинаковыми контрактами — совместимо, без шума от поля версии', () => {
    const contract = () =>
      defineContract({
        name: 'c',
        version: '1.0.0',
        schema: z.object({ a: z.string(), n: z.number().optional() }),
      });
    const verdictBoth = compareSnapshots(
      createSnapshot({ writes: [contract()] }),
      createSnapshot({ reads: [contract()] }),
      { mode: 'aligned' },
    );
    expect([verdictBoth.violations, verdictBoth.unproven, verdictBoth.notes]).toEqual([[], [], []]);
  });
});

describe('одинаковая запись не доказывает одинаковое поведение, если внутри функция', () => {
  it('default вокруг transform у обеих копий — не «совместимо» по записи', () => {
    const make = () =>
      z.object({
        a: z
          .string()
          .transform((value) => value.length)
          .default(1 as never),
      });
    expect(zodVerdict(make(), make())).not.toBe('совместимо');
  });

  it('default вокруг z.unknown().pipe(объединение) — сверяется само объединение', () => {
    const du = (tags: readonly string[]) =>
      z.discriminatedUnion(
        'k',
        tags.map((tag) => z.object({ k: z.literal(tag) })) as unknown as [z.ZodObject, z.ZodObject],
      );
    const writer = z.object({
      a: z
        .unknown()
        .pipe(du(['p', 'q', 'r']))
        .default({ k: 'p' } as never),
    });
    const reader = z.object({
      a: z
        .unknown()
        .pipe(du(['p', 'q']))
        .default({ k: 'p' } as never),
    });
    expect(accepted(reader, { a: { k: 'r' } })).toBe(false);
    expect(zodVerdict(writer, reader)).toBe('нарушение');
  });
});

describe('требуемая длина кортежа — по поведению zod, а не по тому, принимает ли член undefined', () => {
  it('[unknown?] против [unknown] и против массива из одного — писатель вправе прислать []', () => {
    const writer = z.tuple([z.unknown().optional()]);
    expect(writer.safeParse([]).success).toBe(true);
    expect(accepted(z.tuple([z.unknown()]), [])).toBe(z.tuple([z.unknown()]).safeParse([]).success);
    if (!z.tuple([z.unknown()]).safeParse([]).success) {
      expect(zodVerdict(writer, z.tuple([z.unknown()]))).toBe('нарушение');
    }
    expect(zodVerdict(writer, z.array(z.unknown()).min(1).max(1))).toBe('нарушение');
    expect(zodVerdict(writer, writer)).toBe('совместимо');
  });

  it('[unknown] с хвостом zod принимает и пустым — писатель вправе прислать [], читатель min(1) его отвергнет', () => {
    const writer = z.tuple([z.unknown()], z.boolean());
    expect(writer.safeParse([]).success).toBe(true);
    expect(accepted(z.array(z.unknown()).min(1), [])).toBe(false);
    expect(zodVerdict(writer, z.array(z.unknown()).min(1))).toBe('нарушение');
  });

  it('образец короче требуемого — отклонение', () => {
    expect(validateAgainstShape([], shapeFromZod(z.tuple([z.unknown()])))).toEqual(
      z.tuple([z.unknown()]).safeParse([]).success
        ? []
        : [{ path: '', message: 'элементов 0, кортеж требует не меньше 1' }],
    );
  });
});

describe('формат с выражением проверяется и образцом', () => {
  it('строка, не проходящая выражение uuid, — отклонение образца', () => {
    expect(validateAgainstShape('x1', shapeFromZod(z.uuid())).map((issue) => issue.message)).toEqual([
      'не проходит формат uuid',
    ]);
    expect(validateAgainstShape('00000000-0000-0000-0000-000000000000', shapeFromZod(z.uuid()))).toEqual([]);
  });
});
