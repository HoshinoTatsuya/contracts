import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { runCli } from '../cli/run-cli';
import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import { applyKnown } from './apply-known';
import { checkEvolution } from './check-evolution';
import { compareSnapshots } from './compare-snapshots';
import { formatVerdict } from './format-verdict';

/**
 * «Не доказано» — третий исход сверки: не нарушение и не «совместимо».
 * Красный по умолчанию, адресуется известными расхождениями, у CLI — свой код
 * выхода; в изменении своей стороны одинаковый непрозрачный узел — замечание.
 */
const trimmed = (version: string) =>
  defineContract({
    name: 'm',
    version,
    schema: z.object({ id: z.string().transform((value) => value.trim()) }),
  });
const plain = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ id: z.string() }) });

describe('не доказано', () => {
  it('transform читателя: не нарушение и не «совместимо»', () => {
    const verdict = compareSnapshots(
      createSnapshot({ writes: [plain] }),
      createSnapshot({ reads: [trimmed('1.0.0')] }),
    );
    expect({
      ok: verdict.ok,
      violations: verdict.violations.length,
      unproven: verdict.unproven.map((finding) => `${finding.code} ${finding.path}`),
    }).toEqual({ ok: false, violations: 0, unproven: ['not-proven id'] });
    expect(formatVerdict(verdict, 'сверка')).toContain('НЕ ДОКАЗАНО 1');
  });

  it('coerce и catch у читателя — «не доказано», а не нарушение и не «совместимо»', () => {
    const pair = (reader: z.ZodType) => {
      const verdict = compareSnapshots(
        createSnapshot({
          writes: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({ id: z.string() }) })],
        }),
        createSnapshot({
          reads: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({ id: reader }) })],
        }),
      );
      return [verdict.violations.length, verdict.unproven.map((finding) => finding.path)];
    };
    // '5' coerce примет, 'abc' — нет; catch примет всё, но строку молча заменит нулём.
    expect(pair(z.coerce.number())).toEqual([0, ['id']]);
    expect(pair(z.number().catch(0))).toEqual([0, ['id']]);
  });

  it('зеркало одинаковых копий с transform — «не доказано»: одна запись не значит одна функция', () => {
    const verdict = compareSnapshots(
      createSnapshot({ both: [trimmed('1.0.0')] }),
      createSnapshot({ both: [trimmed('1.0.0')] }),
      {
        mode: 'mirror',
      },
    );
    expect([verdict.violations.length, verdict.unproven.map((finding) => finding.path)]).toEqual([0, ['id']]);
  });

  it('известное расхождение адресует «не доказано»', () => {
    const verdict = compareSnapshots(
      createSnapshot({ writes: [plain] }),
      createSnapshot({ reads: [trimmed('1.0.0')] }),
    );
    const outcome = applyKnown(verdict, {
      'm not-proven id': 'читатель только обрезает пробелы, отказа в transform нет',
    });
    expect({ ok: outcome.verdict.ok, stale: outcome.stale }).toEqual({ ok: true, stale: [] });
  });

  it('изменение своей стороны: тот же transform в обеих версиях — замечание, а не «не доказано»', () => {
    const verdict = checkEvolution(
      createSnapshot({ reads: [trimmed('1.0.0')] }),
      createSnapshot({ reads: [trimmed('1.1.0')] }),
    );
    expect({
      unproven: verdict.unproven.length,
      notes: verdict.notes.filter((note) => note.code === 'not-proven').map((note) => note.path),
    }).toEqual({ unproven: 0, notes: ['id'] });
  });

  it('изменение своей стороны: transform появился — «не доказано»', () => {
    const verdict = checkEvolution(
      createSnapshot({ reads: [plain] }),
      createSnapshot({ reads: [trimmed('1.1.0')] }),
    );
    expect(verdict.unproven.map((finding) => finding.path)).toEqual(['id']);
  });

  it('CLI: только «не доказано» — код 3, нарушения — код 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contracts-unproven-'));
    try {
      writeFileSync(join(dir, 'w.json'), serializeSnapshot(createSnapshot({ writes: [plain] })));
      writeFileSync(join(dir, 'r.json'), serializeSnapshot(createSnapshot({ reads: [trimmed('1.0.0')] })));
      const strict = defineContract({ name: 'm', version: '1.0.0', schema: z.object({ id: z.number() }) });
      writeFileSync(join(dir, 'n.json'), serializeSnapshot(createSnapshot({ reads: [strict] })));
      const io = { cwd: dir, stdout: () => undefined, stderr: () => undefined };
      expect(runCli(['check', '--mine', 'w.json', '--peer', 'r.json'], io)).toBe(3);
      expect(runCli(['check', '--mine', 'w.json', '--peer', 'n.json'], io)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
