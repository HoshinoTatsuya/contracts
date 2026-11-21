import { z } from 'zod';

import type { Finding } from '../types/finding.type';
import type { Shape } from '../types/shape.type';
import { shapeFromZod } from '../zod/shape-from-zod';
import { compareShapes } from './compare-shapes';

/**
 * Читатель — объединение: выбор варианта по метке и разбор набора строк по
 * вариантам. Ожидание — ровно список `код путь`, а не «есть хоть одно»:
 * ложное нарушение так же неверно, как пропущенное.
 */
const MODES = ['compatible', 'aligned'] as const;

const run = (writer: Shape, reader: Shape, mode: 'compatible' | 'aligned' = 'compatible') => {
  const outcome = compareShapes(writer, reader, { contract: 't', mode });
  const codes = (findings: readonly Finding[]): string[] =>
    findings.map((finding) => `${finding.code} ${finding.path}`).sort();
  return {
    violations: codes(outcome.violations),
    notes: codes(outcome.notes),
    messages: outcome.violations.map((finding) => finding.message),
  };
};
const verdict = (writer: z.ZodType, reader: z.ZodType, mode: 'compatible' | 'aligned' = 'compatible') =>
  run(shapeFromZod(writer), shapeFromZod(reader), mode);

describe('объединение у читателя: метка — поле, РАЗЛИЧАЮЩЕЕ варианты', () => {
  // Постоянное поле `protocol` стоит по алфавиту раньше метки `type`.
  const variantA = z.strictObject({ protocol: z.literal('p1'), type: z.literal('a'), x: z.string() });
  const variantB = z.strictObject({ protocol: z.literal('p1'), type: z.literal('b'), y: z.number() });
  const MESSAGE = z.discriminatedUnion('type', [variantA, variantB]);

  it.each(MODES)('форма против самой себя — без нарушений и замечаний (%s)', (mode) => {
    expect(verdict(MESSAGE, MESSAGE, mode)).toEqual({ violations: [], notes: [], messages: [] });
  });

  it('постоянное поле ПОСЛЕ метки по алфавиту — тоже без нарушений', () => {
    const shape = z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('a'), zone: z.literal('z1'), x: z.string() }),
      z.strictObject({ kind: z.literal('b'), zone: z.literal('z1'), y: z.number() }),
    ]);
    expect(verdict(shape, shape, 'aligned').violations).toEqual([]);
  });

  it('новый вариант писателя — нарушение по метке, а не по постоянному полю', () => {
    const next = z.discriminatedUnion('type', [
      variantA,
      variantB,
      z.strictObject({ protocol: z.literal('p1'), type: z.literal('c'), z: z.boolean() }),
    ]);
    const outcome = verdict(next, MESSAGE);
    expect(outcome.violations).toEqual(['wire-value-unknown type']);
    expect(outcome.messages).toEqual([expect.stringContaining('«c»')]);
  });

  it('поле внутри варианта сменило тип — путь внутри ЭТОГО варианта', () => {
    const next = z.discriminatedUnion('type', [
      variantA,
      z.strictObject({ protocol: z.literal('p1'), type: z.literal('b'), y: z.string() }),
    ]);
    expect(verdict(next, MESSAGE).violations).toEqual(['type-changed y']);
  });

  it('постоянное поле разошлось у писателя — нарушение по нему', () => {
    const next = z.discriminatedUnion('type', [
      variantA.extend({ protocol: z.literal('p2') }),
      variantB.extend({ protocol: z.literal('p2') }),
    ]);
    expect(verdict(next, MESSAGE).violations).toEqual([
      'wire-value-unknown protocol',
      'wire-value-unknown protocol',
    ]);
  });

  it('варианты различает только СОЧЕТАНИЕ меток — выбор по всем меткам сразу', () => {
    const combined = z.union([
      z.strictObject({ proto: z.literal('p1'), type: z.literal('a'), x: z.string() }),
      z.strictObject({ proto: z.literal('p2'), type: z.literal('a'), y: z.number() }),
      z.strictObject({ proto: z.literal('p2'), type: z.literal('b'), w: z.boolean() }),
    ]);
    expect(verdict(combined, combined, 'aligned').violations).toEqual([]);
    const outcome = verdict(
      z.strictObject({ proto: z.literal('p1'), type: z.literal('b'), x: z.string() }),
      combined,
    );
    expect(outcome.violations).toEqual(['union-option-unmatched ']);
    expect(outcome.messages).toEqual([expect.stringContaining('сочетание меток')]);
  });

  it('меток, различающих варианты, нет — выбор сверкой формы; не подошёл ни один — отказ с причиной', () => {
    const untagged = z.union([
      z.strictObject({ protocol: z.literal('p1'), x: z.string() }),
      z.strictObject({ protocol: z.literal('p1'), y: z.number() }),
    ]);
    expect(verdict(untagged, untagged, 'aligned').violations).toEqual([]);
    const outcome = verdict(z.strictObject({ protocol: z.literal('p1'), z: z.boolean() }), untagged);
    expect(outcome.violations).toEqual(['union-option-unmatched ']);
    expect(outcome.messages).toEqual([expect.stringContaining('не различают')]);
  });

  it('размеченное объединение с null у читателя — метка всё равно выбирает вариант', () => {
    const variant = (kind: string) => z.strictObject({ kind: z.literal(kind), at: z.string() });
    const reader = z.discriminatedUnion('kind', [variant('a'), variant('b')]).nullable();
    expect(verdict(reader, reader, 'aligned').violations).toEqual([]);
    expect(verdict(variant('c'), reader).violations).toEqual(['wire-value-unknown kind']);
  });
});

describe('набор строк писателя против объединения у читателя: каждое значение — по вариантам', () => {
  const FAILURE = z.enum(['callbacks_unsettled', 'write_failed']).nullable();

  it.each(MODES)('enum|null против enum|null — без нарушений и без переполнения стека (%s)', (mode) => {
    expect(verdict(FAILURE, FAILURE, mode).violations).toEqual([]);
  });

  it('внутри необязательного поля варианта — тоже', () => {
    const shape = z.object({ failure: FAILURE.optional() });
    expect(verdict(shape, shape, 'aligned').violations).toEqual([]);
  });

  it('значение, которого читатель не знает, названо — и только оно', () => {
    const outcome = verdict(z.enum(['callbacks_unsettled', 'timeout', 'write_failed']).nullable(), FAILURE);
    expect(outcome.violations).toEqual(['wire-value-unknown ']);
    expect(outcome.messages).toEqual([expect.stringContaining('«timeout»')]);
    expect(outcome.messages[0]).not.toContain('«write_failed»');
  });

  it('значения расходятся по РАЗНЫМ вариантам читателя — каждое принимает свой', () => {
    const reader = z.union([z.enum(['a']), z.string().regex(/^b/), z.number()]);
    expect(verdict(z.enum(['a', 'b1']), reader).violations).toEqual([]);
    const outcome = verdict(z.enum(['a', 'b1', 'c']), reader);
    expect(outcome.violations).toEqual(['wire-value-unknown ']);
    expect(outcome.messages).toEqual([expect.stringContaining('«c»')]);
  });
});

describe('предохранитель глубины сверки', () => {
  const nested = (depth: number): Shape => {
    let shape: Shape = { kind: 'string' };
    for (let level = 0; level < depth; level += 1) {
      shape = { kind: 'array', element: shape };
    }
    return shape;
  };

  it('обычная глубина сверяется', () => {
    expect(run(nested(100), nested(100)).violations).toEqual([]);
  });

  it('глубже потолка — понятный отказ с путём, а не переполнение стека', () => {
    expect(() => run(nested(300), nested(300))).toThrow(
      expect.objectContaining({
        name: 'ShapeComparisonError',
        message: expect.stringContaining('глубже 256'),
      }),
    );
  });
});
