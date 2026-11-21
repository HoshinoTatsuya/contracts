import { z } from 'zod';

import { validateAgainstShape } from '../compare/validate-against-shape';
import { ContractDefinitionError } from '../errors/contract-definition.error';
import { SnapshotFormatError } from '../errors/snapshot-format.error';
import { defineContract } from '../runtime/define-contract';
import { wireFromValues } from '../wire/wire-from-values';
import { shapeFromZod } from '../zod/shape-from-zod';
import { assertShape } from './assert-shape';
import { createSnapshot } from './create-snapshot';
import { parseSnapshot } from './parse-snapshot';
import { serializeSnapshot } from './serialize-snapshot';

/**
 * Формат снимка и то, что в нём обязано держаться: незнакомое — отказ, а не
 * молчаливый пропуск; обязательность поля — та, что у установленного zod на
 * деле, а не выведенная из внутренних флагов, которые меняются от минора к
 * минору.
 */
describe('формат снимка', () => {
  it('незнакомый ключ узла формы — отказ: новая семантика не пропускается молча', () => {
    expect(() =>
      assertShape({ kind: 'union', options: [{ kind: 'string' }], exclusive: true }, 'peer', ''),
    ).toThrow(SnapshotFormatError);
    expect(() => assertShape({ kind: 'string', patterns: ['^a'], flags: 'i' }, 'peer', '')).toThrow(
      SnapshotFormatError,
    );
  });

  it('шаблон, который не литерал или не компилируется, — отказ при разборе, а не падение сверки', () => {
    expect(() => assertShape({ kind: 'string', patterns: ['/(/'] }, 'peer', '')).toThrow(SnapshotFormatError);
  });

  it('снимок прежнего формата — отказ с указанием, что пересобрать', () => {
    const text = JSON.stringify({ format: 'contracts-snapshot/1', contracts: {} });
    expect(() => parseSnapshot(text, 'peer')).toThrow(/пересобер/);
  });

  it('снимок своей стороны переживает собственный разбор', () => {
    const contract = defineContract({
      name: 'c',
      version: '1.0.0',
      schema: z.object({ a: z.coerce.number(), b: z.string().regex(/x/i), c: z.string().refine(Boolean) }),
    });
    const document = createSnapshot({ writes: [contract] });
    expect(parseSnapshot(serializeSnapshot(document), 'self')).toEqual(document);
  });
});

describe('обязательность поля — как у установленного zod', () => {
  const CASES: ReadonlyArray<readonly [string, z.ZodType]> = [
    ['optional', z.string().optional()],
    ['default', z.string().default('x')],
    ['catch', z.string().catch('x')],
    ['nullish', z.string().nullish()],
    ['coerce.string', z.coerce.string()],
    ['coerce.number', z.coerce.number()],
    ['preprocess с подстановкой', z.preprocess((value) => value ?? 'd', z.string())],
    ['preprocess без подстановки', z.preprocess((value) => value, z.string())],
    ['union с undefined', z.union([z.string(), z.undefined()])],
    ['unknown', z.unknown()],
    ['undefined', z.undefined()],
    ['optional + pipe в обязательное', z.string().optional().pipe(z.string())],
    ['exactOptional', z.string().exactOptional()],
  ];
  it.each(CASES)('%s: optional в снимке ⇔ zod принимает объект без поля', (_name, schema) => {
    const shape = shapeFromZod(z.object({ a: schema })) as unknown as {
      fields: { a: { optional: boolean } };
    };
    expect(shape.fields.a.optional).toBe(z.object({ a: schema }).safeParse({}).success);
  });
});

describe('проверка образца по снимку', () => {
  it('шаблон проверяется с его флагами: /^a$/i принимает «A»', () => {
    expect(validateAgainstShape('A', shapeFromZod(z.string().regex(/^a$/i)))).toEqual([]);
    expect(validateAgainstShape('A', shapeFromZod(z.string().regex(/^a$/)))).not.toEqual([]);
  });

  it('поле constructor, которого в образце нет, — «нет обязательного поля»', () => {
    expect(validateAgainstShape({}, shapeFromZod(z.object({ constructor: z.string() })))).toEqual([
      { path: 'constructor', message: 'нет обязательного поля' },
    ]);
  });
});

describe('формат строки в снимке', () => {
  it('встроенный формат — с выражением, которым его проверяет установленный zod (у миноров оно разное)', () => {
    const literal = (pattern: RegExp): string => JSON.stringify(`/${pattern.source}/${pattern.flags}`);
    const email = (z.email() as unknown as { _zod: { def: { pattern: RegExp } } })._zod.def.pattern;
    expect(shapeFromZod(z.email())).toEqual({
      kind: 'string',
      formats: [`email{"pattern":${literal(email)}}`],
    });
    const v4 = (z.uuidv4() as unknown as { _zod: { def: { pattern: RegExp } } })._zod.def.pattern;
    expect(shapeFromZod(z.uuidv4())).toEqual({
      kind: 'string',
      formats: [`uuid{"pattern":${literal(v4)},"version":"v4"}`],
    });
  });

  it('своё выражение и формат, которого zod не знает, — выражение в записи', () => {
    const custom = shapeFromZod(z.email({ pattern: z.regexes.html5Email })) as {
      formats?: readonly string[];
    };
    expect(custom.formats?.[0]?.startsWith('email{"pattern":"/^[a-zA-Z0-9.!#')).toBe(true);
    expect(shapeFromZod(z.stringFormat('mine', /^a/))).toEqual({
      kind: 'string',
      formats: ['mine{"pattern":"/^a/"}'],
    });
  });
});

describe('глубина схемы', () => {
  it('схема глубже потолка — отказ контракта с путём, а не переполнение стека', () => {
    let deep: z.ZodType = z.string();
    for (let level = 0; level < 300; level += 1) {
      deep = z.object({ n: deep });
    }
    expect(() => shapeFromZod(deep)).toThrow(ContractDefinitionError);
    expect(() => shapeFromZod(deep)).toThrow('глубже 256');
  });
});

describe('значения на проводе', () => {
  it('два пути в одну запись — отказ, а не молча затёртое значение', () => {
    expect(() => wireFromValues({ 'a.b': 'x', a: { b: 'y' } })).toThrow('a.b');
  });
});
