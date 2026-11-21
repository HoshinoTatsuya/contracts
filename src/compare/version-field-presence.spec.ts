import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { gateChecks } from '../jest/gate-checks';
import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import type { ContractDefinition } from '../types/contract-definition.type';
import type { ZodLike } from '../types/zod-like.type';
import { compareSnapshots } from './compare-snapshots';

/**
 * Вердикт сверки против ФАКТА: `write()` писателя → JSON → `read()` читателя.
 * «Совместимо» при отвергнутом факте — ложно-зелёное, ради которого
 * библиотека и существует.
 *
 * - поле версии — часть payload: строгий читатель, типизированный
 *   `catchall`, корень-словарь и своё поле того же имени другого типа
 *   отвергают его — это нарушение, а не замечание;
 * - поле, принимающее `undefined` (zod 4.4+: `z.unknown()`, `z.any()`,
 *   объединение с `z.undefined()`), писатель вправе положить `undefined` —
 *   по JSON оно пропадёт, а читатель его требует;
 * - `refine` объекта с `path` не делает поле обязательным в границе `upper`.
 */
type Definition = Omit<ContractDefinition<ZodLike, undefined>, 'name' | 'version'> & {
  readonly version?: string;
};

const verdictOf = (
  writer: Definition,
  reader: Definition,
  data: unknown,
  mode: 'compatible' | 'aligned' = 'compatible',
) => {
  const W = defineContract({ name: 'c', version: '1.0.0', ...writer });
  const R = defineContract({ name: 'c', version: '1.0.0', ...reader });
  const verdict = compareSnapshots(
    { format: 'contracts-snapshot/2', contracts: { c: W.snapshot('writer') } },
    { format: 'contracts-snapshot/2', contracts: { c: R.snapshot('reader') } },
    { mode },
  );
  let fact: string;
  try {
    R.read(JSON.parse(JSON.stringify(W.write(data as never))));
    fact = 'принят';
  } catch {
    fact = 'отвергнут';
  }
  const outcome =
    verdict.violations.length > 0 ? 'нарушение' : verdict.unproven.length > 0 ? 'не доказано' : 'совместимо';
  return {
    outcome,
    fact,
    codes: [...verdict.violations, ...verdict.unproven].map((finding) => `${finding.code} ${finding.path}`),
  };
};

describe('поле версии писателя — часть его формы (versionField × legacy × политика читателя)', () => {
  const object = z.object({ a: z.number() });
  const rows: Array<[string, Definition, Definition, string, string]> = [
    [
      'читатель без версии, корень-словарь чисел',
      { schema: object },
      { versionField: null, schema: z.record(z.string(), z.number()) },
      'нарушение',
      'отвергнут',
    ],
    [
      'читатель без версии, catchall чисел',
      { schema: object },
      { versionField: null, schema: object.catchall(z.number()) },
      'нарушение',
      'отвергнут',
    ],
    [
      'читатель без версии, своё contractVersion: number',
      { schema: object },
      { versionField: null, schema: z.object({ a: z.number(), contractVersion: z.number().optional() }) },
      'нарушение',
      'отвергнут',
    ],
    [
      'своё поле v + legacy, строгий читатель',
      { versionField: 'v', schema: object },
      { legacyVersion: '1.0.0', schema: z.strictObject({ a: z.number() }) },
      'нарушение',
      'отвергнут',
    ],
    [
      'своё поле v + legacy, catchall чисел',
      { versionField: 'v', schema: object },
      { legacyVersion: '1.0.0', schema: object.catchall(z.number()) },
      'нарушение',
      'отвергнут',
    ],
    [
      'читатель без версии, строгий',
      { schema: object },
      { versionField: null, schema: z.strictObject({ a: z.number() }) },
      'нарушение',
      'отвергнут',
    ],
    [
      'контроль: одно поле версии, строгий читатель',
      { schema: object },
      { schema: z.strictObject({ a: z.number() }) },
      'совместимо',
      'принят',
    ],
    [
      'контроль: читатель без версии, выбрасывает лишнее',
      { schema: object },
      { versionField: null, schema: object },
      'совместимо',
      'принят',
    ],
    [
      'контроль: своё поле v + legacy, выбрасывающий читатель',
      { versionField: 'v', schema: object },
      { legacyVersion: '1.0.0', schema: object },
      'совместимо',
      'принят',
    ],
    [
      'контроль: читатель без версии, catchall строк',
      { schema: object },
      { versionField: null, schema: object.catchall(z.string()) },
      'совместимо',
      'принят',
    ],
    [
      'контроль: писатель без версии, читатель с legacy',
      { versionField: null, schema: object },
      { legacyVersion: '1.0.0', schema: z.strictObject({ a: z.number() }) },
      'совместимо',
      'принят',
    ],
  ];
  it.each(rows)('%s', (_name, writer, reader, outcome, fact) => {
    const result = verdictOf(writer, reader, { a: 1 });
    expect([result.outcome, result.fact]).toEqual([outcome, fact]);
  });

  it('образцы писателя проверяются вместе с его полем версии', () => {
    const W = defineContract({
      name: 'c',
      version: '1.0.0',
      versionField: 'v',
      schema: z.object({ a: z.number() }),
      examples: [{ a: 1 }],
    });
    const R = defineContract({
      name: 'c',
      version: '1.0.0',
      legacyVersion: '1.0.0',
      schema: z.strictObject({ a: z.number() }),
    });
    const verdict = compareSnapshots(
      { format: 'contracts-snapshot/2', contracts: { c: W.snapshot('writer') } },
      { format: 'contracts-snapshot/2', contracts: { c: R.snapshot('reader') } },
    );
    expect(verdict.violations.map((finding) => `${finding.code} ${finding.path}`).sort()).toEqual([
      'example-rejected v',
      'field-rejected v',
    ]);
  });

  it('гейт runtime подставляет поле версии ПИСАТЕЛЯ: строгий читатель отвергает образец', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contracts-version-gate-'));
    try {
      const W = defineContract({
        name: 'c',
        version: '1.0.0',
        versionField: 'v',
        schema: z.object({ a: z.number() }),
        examples: [{ a: 1 }],
      });
      const R = defineContract({
        name: 'c',
        version: '1.0.0',
        legacyVersion: '1.0.0',
        schema: z.strictObject({ a: z.number() }),
      });
      writeFileSync(join(dir, 'peer.json'), serializeSnapshot(createSnapshot({ writes: [W] })));
      const snapshot = () => createSnapshot({ reads: [R] });
      writeFileSync(join(dir, 'mine.json'), serializeSnapshot(snapshot()));
      const { checks } = gateChecks({
        root: dir,
        snapshot,
        committed: 'mine.json',
        minContracts: 1,
        runtime: [R],
        peers: [{ name: 'p', source: { kind: 'file', path: 'peer.json' } }],
      });
      const failed = checks.flatMap((check) => {
        try {
          check.run();
          return [];
        } catch (error) {
          return [`${check.name} :: ${(error as Error).message}`];
        }
      });
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatch(/нарушений вне известных расхождений нет/);
      expect(failed[0]).toMatch(/example-rejected examples\[0\].*Unrecognized key: "v"/s);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('поле, принимающее undefined, на проводе необязательно (zod 4.4+)', () => {
  it.each([
    ['z.unknown()', z.unknown()],
    ['z.any()', z.any()],
    ['union с z.undefined()', z.union([z.string(), z.undefined()])],
  ])('%s у обеих сторон — нарушение field-may-be-missing, факт — отказ', (_name, field) => {
    const schema = z.object({ id: z.string(), meta: field });
    const result = verdictOf({ schema }, { schema }, { id: 'x', meta: undefined });
    expect(result).toEqual({ outcome: 'нарушение', fact: 'отвергнут', codes: ['field-may-be-missing meta'] });
  });

  it('контроль: .optional() у обеих сторон — совместимо', () => {
    const schema = z.object({ id: z.string(), meta: z.unknown().optional() });
    expect(verdictOf({ schema }, { schema }, { id: 'x', meta: undefined })).toEqual({
      outcome: 'совместимо',
      fact: 'принят',
      codes: [],
    });
  });

  it('словарь с конечным набором ключей и значением unknown: вердикт согласован с фактом', () => {
    const schema = z.object({ m: z.record(z.enum(['a']), z.unknown()) });
    const result = verdictOf({ schema }, { schema }, { m: { a: undefined } });
    // zod принимает словарь без ключа, значение которого принимает undefined, — и сверка это знает.
    expect([result.outcome, result.fact]).toEqual(['совместимо', 'принят']);
  });
});

describe('refine объекта с path не делает поле обязательным в upper', () => {
  it('«хотя бы одно из a/b» с path b у писателя против читателя, требующего b', () => {
    const writer = z
      .object({ a: z.string().optional(), b: z.string().optional() })
      .refine((value) => value.a !== undefined || value.b !== undefined, { path: ['b'] });
    const result = verdictOf(
      { versionField: null, schema: writer },
      { versionField: null, schema: z.object({ a: z.string().optional(), b: z.string() }) },
      { a: 'x' },
    );
    expect(result).toEqual({ outcome: 'нарушение', fact: 'отвергнут', codes: ['field-may-be-missing b'] });
  });

  it('контроль: refine без path и обязательное поле — обязательность прежняя', () => {
    const writer = z.object({ a: z.string(), b: z.string().optional() }).refine(() => true);
    const result = verdictOf(
      { versionField: null, schema: writer },
      { versionField: null, schema: z.object({ a: z.string() }) },
      { a: 'x' },
    );
    expect([result.outcome, result.fact]).toEqual(['совместимо', 'принят']);
  });
});
