import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import type { Verdict } from '../types/verdict.type';
import { typeScriptContract } from '../typescript/type-script-contract';
import { applyKnown } from './apply-known';
import { checkEvolution } from './check-evolution';
import { compareSnapshots } from './compare-snapshots';

/**
 * Политика ЗАПИСИ — часть контракта: писатель с `unknownFields: 'keep'` и
 * писатель-тип TypeScript кладут на провод поля вне формы, писатель с
 * `legacyVersion`-читателем вправе не класть версию. Снимок без этого
 * отвечал «совместимо» там, где строгий читатель отвергает каждое сообщение.
 */
const dir = mkdtempSync(join(tmpdir(), 'contracts-policy-spec-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
const file = join(dir, 'job.ts');
writeFileSync(file, 'export interface IJob { a: string }\n');

const red = (verdict: Verdict): boolean =>
  verdict.violations.length + ((verdict as { unproven?: readonly unknown[] }).unproven?.length ?? 0) > 0;
const codes = (verdict: Verdict): string[] =>
  [...verdict.violations, ...((verdict as { unproven?: Verdict['violations'] }).unproven ?? [])]
    .map((finding) => `${finding.code} ${finding.path}`)
    .sort();
const strictReader = defineContract({
  name: 'm',
  version: '1.0.0',
  schema: z.strictObject({ a: z.string() }),
});

describe('политика записи в снимке', () => {
  it('писатель unknownFields: keep против строгого читателя — красное', () => {
    const writer = defineContract({
      name: 'm',
      version: '1.0.0',
      schema: z.object({ a: z.string() }),
      unknownFields: 'keep',
    });
    expect(() =>
      strictReader.read(JSON.parse(JSON.stringify(writer.write({ a: 'x', extra: 1 } as { a: string })))),
    ).toThrow();
    const verdict = compareSnapshots(
      createSnapshot({ writes: [writer] }),
      createSnapshot({ reads: [strictReader] }),
    );
    expect(codes(verdict)).toEqual(['open-to-strict {*}']);
  });

  it('писатель-тип TypeScript против строгого читателя — красное', () => {
    const writer = typeScriptContract({
      name: 'm',
      version: '1.0.0',
      file,
      type: 'IJob',
      versionField: 'contractVersion',
    });
    const verdict = compareSnapshots(
      createSnapshot({ writes: [writer] }),
      createSnapshot({ reads: [strictReader] }),
    );
    expect(codes(verdict)).toEqual(['open-to-strict {*}']);
  });

  it('писатель-тип TypeScript против необязательного поля читателя — «не доказано»: имя может прийти с любым значением', () => {
    const writer = typeScriptContract({
      name: 'm',
      version: '1.0.0',
      file,
      type: 'IJob',
      versionField: 'contractVersion',
    });
    const reader = defineContract({
      name: 'm',
      version: '1.0.0',
      schema: z.object({ a: z.string(), b: z.string().optional() }),
    });
    const verdict = compareSnapshots(
      createSnapshot({ writes: [writer] }),
      createSnapshot({ reads: [reader] }),
    );
    expect(codes(verdict)).toEqual(['not-proven b']);
  });

  it('писатель strip против строгого читателя — зелёное: write() отвергает лишнее', () => {
    const writer = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.string() }) });
    expect(() => writer.write({ a: 'x', extra: 1 } as { a: string })).toThrow();
    const verdict = compareSnapshots(
      createSnapshot({ writes: [writer] }),
      createSnapshot({ reads: [strictReader] }),
    );
    expect(red(verdict)).toBe(false);
  });

  it('зеркало: политика записи разошлась — нарушение', () => {
    const a = defineContract({
      name: 'm',
      version: '1.0.0',
      schema: z.object({ a: z.string() }),
      unknownFields: 'keep',
    });
    const b = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.string() }) });
    const verdict = compareSnapshots(createSnapshot({ writes: [a] }), createSnapshot({ writes: [b] }), {
      mode: 'mirror',
    });
    expect(red(verdict)).toBe(true);
  });

  it('писатель без версии и читатель с legacyVersion — совместимо; без legacyVersion — красное', () => {
    const writer = typeScriptContract({ name: 'm', version: '1.0.0', file, type: 'IJob' });
    const tolerant = defineContract({
      name: 'm',
      version: '1.0.0',
      schema: z.object({ a: z.string() }),
      legacyVersion: '1.0.0',
    });
    const strict = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.string() }) });
    expect(tolerant.read({ a: 'x' }).version).toBe('1.0.0');
    expect(() => strict.read({ a: 'x' })).toThrow();
    expect(
      red(compareSnapshots(createSnapshot({ writes: [writer] }), createSnapshot({ reads: [tolerant] }))),
    ).toBe(false);
    expect(
      red(compareSnapshots(createSnapshot({ writes: [writer] }), createSnapshot({ reads: [strict] }))),
    ).toBe(true);
  });

  it('зеркало: legacyVersion разошлась — нарушение', () => {
    const a = defineContract({
      name: 'm',
      version: '1.0.0',
      schema: z.object({ a: z.string() }),
      legacyVersion: '1.0.0',
    });
    const b = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.string() }) });
    expect(
      red(
        compareSnapshots(createSnapshot({ reads: [a] }), createSnapshot({ reads: [b] }), { mode: 'mirror' }),
      ),
    ).toBe(true);
  });

  it('изменение: читатель убрал legacyVersion — прежние писатели без версии будут отвергнуты', () => {
    const before = defineContract({
      name: 'm',
      version: '1.0.0',
      schema: z.object({ a: z.string() }),
      legacyVersion: '1.0.0',
    });
    const after = defineContract({ name: 'm', version: '1.1.0', schema: z.object({ a: z.string() }) });
    expect(red(checkEvolution(createSnapshot({ reads: [before] }), createSnapshot({ reads: [after] })))).toBe(
      true,
    );
  });

  it('изменение: версия 1.2 и 1.2.0 — одна версия, форма изменилась — version-not-bumped', () => {
    const before = defineContract({ name: 'm', version: '1.2', schema: z.object({ a: z.string() }) });
    const after = defineContract({
      name: 'm',
      version: '1.2.0',
      schema: z.object({ a: z.string(), b: z.string().optional() }),
    });
    expect(
      codes(checkEvolution(createSnapshot({ writes: [before] }), createSnapshot({ writes: [after] }))),
    ).toContain('version-not-bumped ');
  });

  it('aligned: объявленно открытый писатель против strip-читателя — нарушение (наборы полей обязаны совпасть)', () => {
    const writer = defineContract({ name: 'm', version: '1.0.0', schema: z.looseObject({ a: z.string() }) });
    const reader = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.string() }) });
    expect(
      red(
        compareSnapshots(createSnapshot({ writes: [writer] }), createSnapshot({ reads: [reader] }), {
          mode: 'aligned',
        }),
      ),
    ).toBe(true);
  });

  it('известное расхождение может адресовать замечание (пример README не устаревает)', () => {
    const writer = defineContract({
      name: 'm',
      version: '1.0.0',
      schema: z.object({ a: z.string(), trace: z.string().optional() }),
    });
    const reader = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.string() }) });
    const verdict = compareSnapshots(
      createSnapshot({ writes: [writer] }),
      createSnapshot({ reads: [reader] }),
    );
    expect(verdict.notes.map((note) => note.code)).toEqual(['field-unread']);
    const outcome = applyKnown(verdict, {
      'm field-unread trace': 'читатель начнёт читать trace в 1.4, до тех пор выбрасывает',
    });
    expect({ stale: outcome.stale, notes: outcome.verdict.notes.length }).toEqual({ stale: [], notes: 0 });
  });

  it('only без совпадений — не «совместимо»', () => {
    const writer = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.string() }) });
    const reader = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.number() }) });
    let verdict: Verdict | undefined;
    try {
      verdict = compareSnapshots(createSnapshot({ writes: [writer] }), createSnapshot({ reads: [reader] }), {
        only: ['mm'],
      });
    } catch {
      verdict = undefined;
    }
    expect(verdict === undefined || red(verdict)).toBe(true);
  });
});
