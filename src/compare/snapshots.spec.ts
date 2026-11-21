import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import { SnapshotFormatError } from '../errors/snapshot-format.error';
import { checkRoutes } from '../routes/check-routes';
import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { parseSnapshot } from '../snapshot/parse-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import { writeSnapshot } from '../snapshot/write-snapshot';
import type { SnapshotDocument } from '../types/snapshot-document.type';
import { applyKnown } from './apply-known';
import { checkEvolution } from './check-evolution';
import { compareSnapshots } from './compare-snapshots';
import { findingKey } from './finding-key';

const task = (
  version: string,
  shape: z.ZodRawShape,
  wire: Record<string, unknown> = { queue: 'tasks' },
  examples: unknown[] = [],
) => defineContract({ name: 'task', version, schema: z.object(shape), wire, examples });
const result = (version = '1.0.0') =>
  defineContract({
    name: 'result',
    version,
    schema: z.object({ ok: z.boolean() }),
    wire: { queue: 'results' },
  });
const keys = (document: {
  violations: readonly { contract: string; code: string; path: string }[];
}): string[] => document.violations.map((finding) => findingKey(finding as never));

describe('снимок: детерминизм и формат', () => {
  it('порядок контрактов и полей на текст снимка не влияет', () => {
    const a = createSnapshot({
      writes: [task('1.0.0', { a: z.string(), b: z.number() })],
      reads: [result()],
    });
    const b = createSnapshot({
      reads: [result()],
      writes: [task('1.0.0', { b: z.number(), a: z.string() })],
    });
    expect(serializeSnapshot(a)).toBe(serializeSnapshot(b));
    expect(serializeSnapshot(a).endsWith('}\n')).toBe(true);
  });

  it('разбор отвергает чужой формат, неизвестный вид формы, неизвестную роль', () => {
    const good = JSON.parse(serializeSnapshot(createSnapshot({ writes: [result()] }))) as SnapshotDocument;
    expect(() => parseSnapshot('{', 'x')).toThrow(SnapshotFormatError);
    expect(() => parseSnapshot(JSON.stringify({ ...good, format: 'other/1' }), 'x')).toThrow('поле format');
    const badKind = JSON.parse(JSON.stringify(good)) as {
      contracts: { result: { shape: { kind: string }; role: string } };
    };
    badKind.contracts.result.shape.kind = 'mystery';
    expect(() => parseSnapshot(JSON.stringify(badKind), 'x')).toThrow('неизвестный вид формы');
    badKind.contracts.result.shape.kind = 'object';
    badKind.contracts.result.role = 'owner';
    expect(() => parseSnapshot(JSON.stringify(badKind), 'x')).toThrow('неизвестная роль');
  });

  it('контракт в снимке дважды — отказ', () => {
    expect(() => createSnapshot({ writes: [result()], reads: [result()] })).toThrow(ContractDefinitionError);
  });

  it('форматтер репозитория: содержание не меняется — снимок принят; меняется — отказ; нет форматтера — отказ', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contracts-write-'));
    try {
      const document = createSnapshot({ writes: [result()] });
      const reformat = (file: string): void => {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        writeFileSync(file, JSON.stringify(parsed, null, 4));
      };
      writeSnapshot('a/contracts.snapshot.json', document, { cwd: dir, formatter: reformat });
      expect(readFileSync(join(dir, 'a/contracts.snapshot.json'), 'utf8')).toContain('    "contracts"');
      expect(() =>
        writeSnapshot('b.json', document, {
          cwd: dir,
          formatter: (file) => writeFileSync(file, readFileSync(file, 'utf8').replace('results', 'other')),
        }),
      ).toThrow('форматтер изменил содержание');
      expect(() => writeSnapshot('c.json', document, { cwd: dir, formatter: 'prettier' })).toThrow(
        'не найден',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('сверка снимков двух сторон', () => {
  const writer = (contract: ReturnType<typeof task>) => createSnapshot({ writes: [contract] });
  const reader = (contract: ReturnType<typeof task>) => createSnapshot({ reads: [contract] });
  const base = { id: z.string() };

  it('совместимо в обе стороны ролей; режим зеркала роли не смотрит', () => {
    const next = task('1.1.0', { ...base, trace: z.string().optional() });
    expect(compareSnapshots(writer(next), reader(task('1.0.0', base))).ok).toBe(true);
    expect(compareSnapshots(reader(task('1.0.0', base)), writer(next)).ok).toBe(true);
    expect(keys(compareSnapshots(writer(next), reader(task('1.0.0', base)), { mode: 'mirror' }))).toEqual([
      'task mirror-difference (корень)',
      'task mirror-difference trace',
    ]);
  });

  it('контракт только у одной стороны, роли без пары, разные мажоры и поле версии — нарушения', () => {
    expect(keys(compareSnapshots(createSnapshot({ writes: [result()] }), createSnapshot({})))).toEqual([
      'result contract-missing (корень)',
    ]);
    expect(keys(compareSnapshots(reader(task('1.0.0', base)), reader(task('1.0.0', base))))).toEqual([
      'task roles-mismatch (корень)',
    ]);
    expect(keys(compareSnapshots(writer(task('2.0.0', base)), reader(task('1.0.0', base))))).toEqual([
      'task major-mismatch (корень)',
    ]);
    const other = createSnapshot({
      reads: [
        defineContract({
          name: 'task',
          version: '1.0.0',
          schema: z.object(base),
          versionField: 'v',
          wire: { queue: 'tasks' },
        }),
      ],
    });
    expect(keys(compareSnapshots(writer(task('1.0.0', base)), other))).toEqual([
      'task version-field-mismatch (корень)',
    ]);
  });

  it('значение на проводе: другое имя ключа — нарушение, новое значение — замечание', () => {
    const renamed = compareSnapshots(
      writer(task('1.0.0', base, { queue: 'tasks-v2' })),
      reader(task('1.0.0', base)),
    );
    expect(keys(renamed)).toEqual(['task wire-constant-changed wire:queue']);
    const added = compareSnapshots(
      writer(task('1.0.0', base, { queue: 'tasks', dlq: 'tasks-dlq' })),
      reader(task('1.0.0', base)),
    );
    expect([added.ok, added.notes.map((finding) => finding.code)]).toEqual([true, ['wire-constant-unknown']]);
  });

  it('образцы писателя проверяются формой читателя', () => {
    const loose = task('1.0.0', { id: z.string(), port: z.number().optional() }, { queue: 'tasks' }, [
      { id: 'a', port: 70000 },
    ]);
    const strict = task('1.0.0', { id: z.string(), port: z.number().max(65535).optional() });
    expect(keys(compareSnapshots(writer(loose), reader(strict)))).toEqual([
      'task constraint-narrowed port',
      'task example-rejected port',
    ]);
  });

  it('известные расхождения: допущенное снимается, устаревшее и без причины видно', () => {
    const verdict = compareSnapshots(
      writer(task('1.0.0', base, { queue: 'x' })),
      reader(task('1.0.0', base)),
    );
    const outcome = applyKnown(verdict, {
      'task wire-constant-changed wire:queue': 'очередь переименована, читатель переходит в следующем релизе',
      'task field-required-missing id': 'давно починено, запись осталась по забывчивости автора',
      'task type-changed id': 'коротко',
    });
    expect(outcome.verdict.violations).toEqual([]);
    expect(outcome.stale).toEqual(['task field-required-missing id', 'task type-changed id']);
    expect(outcome.unexplained).toEqual(['task type-changed id']);
  });
});

describe('изменение своего контракта против прежнего снимка', () => {
  const base = { id: z.string() };
  const side = (contract: ReturnType<typeof task>, role: 'writes' | 'reads') =>
    createSnapshot({ [role]: [contract] });

  it('писатель: удалённое обязательное поле ломает читателя прежней версии', () => {
    const verdict = checkEvolution(side(task('1.0.0', base), 'writes'), side(task('1.1.0', {}), 'writes'));
    expect(keys(verdict)).toEqual(['task field-required-missing id']);
  });

  it('читатель: новое обязательное поле ломает писателя прежней версии; у писателя оно же — нет', () => {
    const next = task('1.1.0', { ...base, host: z.string() });
    expect(keys(checkEvolution(side(task('1.0.0', base), 'reads'), side(next, 'reads')))).toEqual([
      'task field-required-missing host',
    ]);
    expect(keys(checkEvolution(side(task('1.0.0', base), 'writes'), side(next, 'writes')))).toEqual([]);
  });

  it('форма изменилась, версия та же; версия снизилась; контракт удалён; значение пропало', () => {
    expect(
      keys(
        checkEvolution(
          side(task('1.0.0', base), 'writes'),
          side(task('1.0.0', { ...base, x: z.string().optional() }), 'writes'),
        ),
      ),
    ).toEqual(['task version-not-bumped (корень)']);
    expect(
      keys(checkEvolution(side(task('1.2.0', base), 'writes'), side(task('1.1.0', base), 'writes'))),
    ).toEqual(['task version-decreased (корень)']);
    expect(keys(checkEvolution(side(task('1.0.0', base), 'writes'), createSnapshot({})))).toEqual([
      'task contract-missing (корень)',
    ]);
    expect(
      keys(checkEvolution(side(task('1.0.0', base), 'writes'), side(task('1.1.0', base, {}), 'writes'))),
    ).toEqual(['task wire-constant-missing wire:queue']);
  });

  it('мажор поднят — форма не сверяется, остаётся замечание', () => {
    const verdict = checkEvolution(side(task('1.0.0', base), 'writes'), side(task('2.0.0', {}), 'writes'));
    expect([verdict.ok, verdict.notes.map((finding) => finding.code)]).toEqual([true, ['major-mismatch']]);
  });
});

describe('маршруты ↔ обработчики', () => {
  it('нет обработчика, два обработчика, чужой обработчик, устаревшие допущения', () => {
    const verdict = checkRoutes({
      declared: ['a', 'b', 'c', 'd'],
      handled: ['a', 'b', 'b', 'x', 'foreign', 'd'],
      unhandled: { c: 'обслуживает другой процесс этого же сервиса', d: 'устарело', z: 'маршрута нет' },
      foreign: { foreign: 'чужой контракт', gone: 'обработчика больше нет' },
    });
    expect(keys(verdict)).toEqual([
      'b route-duplicated (корень)',
      'd route-unhandled (корень)',
      'gone route-undeclared (корень)',
      'x route-undeclared (корень)',
      'z route-unhandled (корень)',
    ]);
    expect(checkRoutes({ declared: ['a'], handled: ['a'] }).ok).toBe(true);
    expect(keys(checkRoutes({ declared: ['a'], handled: [] }))).toEqual(['a route-unhandled (корень)']);
  });
});
