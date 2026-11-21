import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { runCli } from '../cli/run-cli';
import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import { gitFixture } from '../testing/git-fixture';
import { exportTree } from './export-tree';
import { loadPeerSnapshot } from './load-peer-snapshot';
import { parsePeerSource } from './parse-peer-source';

/**
 * Сквозной сценарий на двух временных git-репозиториях: сторона-писатель и
 * сторона-читатель держат каждая свою копию контракта и свой снимок. Сверка
 * идёт CLI, как в джобе CI, со снимком другой стороны из её репозитория:
 * ветка, удалённый клон (file://), развёрнутая ревизия.
 */
const root = mkdtempSync(join(tmpdir(), 'contracts-two-repos-'));
const writerRepo = join(root, 'writer');
const readerRepo = join(root, 'reader');
const SNAPSHOT = 'contracts.snapshot.json';
const DIST_CLI = join(__dirname, '..', '..', 'dist', 'cli', 'main.js');

const fields = { taskId: z.string(), hosts: z.array(z.string()), mode: z.enum(['ip', 'domain']) };
const task = (version: string, shape: z.ZodRawShape) =>
  defineContract({ name: 'scan-task', version, schema: z.object(shape), wire: { queue: 'scan-tasks' } });
const writerSide = (version: string, shape: z.ZodRawShape): string =>
  serializeSnapshot(createSnapshot({ writes: [task(version, shape)] }));
const readerSide = (version: string, shape: z.ZodRawShape): string =>
  serializeSnapshot(createSnapshot({ reads: [task(version, shape)] }));

const cli = (...argv: string[]): { readonly code: number; readonly out: string } => {
  let out = '';
  const code = runCli(argv, {
    cwd: root,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      out += text;
    },
  });
  return { code, out };
};

let readerDeployed = '';

beforeAll(() => {
  gitFixture.init(writerRepo);
  gitFixture.init(readerRepo);
  gitFixture.commit(writerRepo, { [SNAPSHOT]: writerSide('1.0.0', fields) }, 'контракт 1.0.0');
  readerDeployed = gitFixture.commit(
    readerRepo,
    { [SNAPSHOT]: readerSide('1.0.0', fields) },
    'контракт 1.0.0',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('две стороны в двух репозиториях', () => {
  it('копии совпадают — зелёный и в совместимости, и в зеркале', () => {
    const peer = `git:${readerRepo}#main:${SNAPSHOT}`;
    expect(cli('check', '--mine', join(writerRepo, SNAPSHOT), '--peer', peer).code).toBe(0);
    expect(cli('check', '--mine', join(writerRepo, SNAPSHOT), '--peer', peer, '--mode', 'mirror').code).toBe(
      0,
    );
  });

  it('у писателя добавлено необязательное поле — совместимость зелёная, зеркало красное', () => {
    gitFixture.commit(
      writerRepo,
      { [SNAPSHOT]: writerSide('1.1.0', { ...fields, trace: z.string().optional() }) },
      '1.1.0',
    );
    const peer = `git:${readerRepo}#main:${SNAPSHOT}`;
    const compatible = cli('check', '--mine', join(writerRepo, SNAPSHOT), '--peer', peer);
    expect([compatible.code, compatible.out]).toEqual([0, expect.stringContaining('field-unread trace')]);
    const mirror = cli('check', '--mine', join(writerRepo, SNAPSHOT), '--peer', peer, '--mode', 'mirror');
    expect([mirror.code, mirror.out]).toEqual([
      1,
      expect.stringContaining('scan-task mirror-difference trace'),
    ]);
  });

  it('копия читателя разошлась (набор строк сужен) — красный с путём; развёрнутая ревизия — ещё зелёная', () => {
    gitFixture.commit(
      readerRepo,
      { [SNAPSHOT]: readerSide('1.1.0', { ...fields, mode: z.enum(['ip']) }) },
      'сужение',
    );
    const main = cli(
      'check',
      '--mine',
      join(writerRepo, SNAPSHOT),
      '--peer',
      `git:${readerRepo}#main:${SNAPSHOT}`,
    );
    expect([main.code, main.out]).toEqual([1, expect.stringContaining('scan-task wire-value-unknown mode')]);

    // Развёрнута ещё прежняя ревизия читателя: сверка — с ней, а не с main.
    expect(
      cli(
        'record-deployed',
        '--peer',
        'reader',
        '--ref',
        readerDeployed,
        '--snapshot-path',
        SNAPSHOT,
        '--out',
        'reader.deployed.json',
      ).code,
    ).toBe(0);
    expect(
      cli(
        'check',
        '--mine',
        join(writerRepo, SNAPSHOT),
        '--peer',
        `deployed:reader.deployed.json@${readerRepo}`,
      ).code,
    ).toBe(0);
    // Та же запись, но репозиторий — удалённый (file://): ревизия добывается fetch.
    expect(
      cli(
        'check',
        '--mine',
        join(writerRepo, SNAPSHOT),
        '--peer',
        `deployed:reader.deployed.json@file://${readerRepo}`,
      ).code,
    ).toBe(0);
    const cloned = cli(
      'check',
      '--mine',
      join(writerRepo, SNAPSHOT),
      '--peer',
      `clone:file://${readerRepo}#main:${SNAPSHOT}`,
    );
    expect(cloned.code).toBe(1);
  });

  it('изменение своего снимка против прежней ревизии своей ветки', () => {
    gitFixture.commit(
      writerRepo,
      { [SNAPSHOT]: writerSide('1.2.0', { taskId: fields.taskId, mode: fields.mode }) },
      'удалено поле',
    );
    const evolved = cli(
      'evolve',
      '--previous',
      `git:${writerRepo}#HEAD~1:${SNAPSHOT}`,
      '--next',
      join(writerRepo, SNAPSHOT),
    );
    expect([evolved.code, evolved.out]).toEqual([
      1,
      expect.stringContaining('scan-task field-required-missing hosts'),
    ]);
  });

  it('снимок другой стороны не добыт — код 2 «НЕ ПРОВЕРЕНО», а не зелёный', () => {
    const mine = join(writerRepo, SNAPSHOT);
    for (const peer of [
      `git:${join(root, 'nope')}#main:${SNAPSHOT}`,
      `git:${readerRepo}#no-such-branch:${SNAPSHOT}`,
      `git:${readerRepo}#main:missing.json`,
      `clone:file://${join(root, 'nope')}#main:${SNAPSHOT}`,
      join(root, 'nope.json'),
    ]) {
      const outcome = cli('check', '--mine', mine, '--peer', peer);
      expect([peer, outcome.code, outcome.out.startsWith('НЕ ПРОВЕРЕНО')]).toEqual([peer, 2, true]);
    }
    expect(
      cli('record-deployed', '--peer', 'r', '--ref', 'main', '--snapshot-path', SNAPSHOT, '--out', 'x.json')
        .code,
    ).toBe(2);
    writeFileSync(
      join(root, 'branch.deployed.json'),
      JSON.stringify({
        format: 'contracts-deployed/1',
        peer: 'r',
        ref: 'main',
        snapshotPath: SNAPSHOT,
      }),
    );
    expect(cli('check', '--mine', mine, '--peer', `deployed:branch.deployed.json@${readerRepo}`).code).toBe(
      2,
    );
    expect(cli('check', '--mine', mine, '--peer', mine, '--mode', 'mirrored').code).toBe(2);
    expect(cli('check', '--mine', mine, '--pear', mine).code).toBe(2);
  });

  it('загрузчик: каталог как источник, отказ — PeerSnapshotUnavailableError', () => {
    expect(Object.keys(loadPeerSnapshot({ kind: 'file', path: readerRepo }).contracts)).toEqual([
      'scan-task',
    ]);
    expect(() => loadPeerSnapshot({ kind: 'file', path: root })).toThrow(PeerSnapshotUnavailableError);
  });

  it('дерево ревизии — во временном каталоге, а не рабочее дерево клона', () => {
    writeFileSync(join(readerRepo, SNAPSHOT), 'незакоммиченная правка');
    const tree = exportTree(readerRepo, readerDeployed);
    try {
      expect(readFileSync(join(tree.dir, SNAPSHOT), 'utf8')).toBe(readerSide('1.0.0', fields));
    } finally {
      tree.dispose();
    }
    expect(existsSync(tree.dir)).toBe(false);
  });

  it('разбор строки источника: ревизия по последнему #, путь по первому : после неё', () => {
    expect(parsePeerSource('git:C:\\repo#origin/HEAD:a/b.json')).toEqual({
      kind: 'git',
      repo: 'C:\\repo',
      ref: 'origin/HEAD',
      path: 'a/b.json',
    });
    expect(parsePeerSource('clone:https://host/x.git#v1.2:contracts.json')).toEqual({
      kind: 'clone',
      url: 'https://host/x.git',
      ref: 'v1.2',
      path: 'contracts.json',
    });
    expect(parsePeerSource('deployed:rec.json@git@host:x/y.git')).toEqual({
      kind: 'deployed',
      record: 'rec.json',
      repo: 'git@host:x/y.git',
    });
    expect(parsePeerSource('a.json')).toEqual({ kind: 'file', path: 'a.json' });
    expect(() => parsePeerSource('git:repo-without-ref')).toThrow(PeerSnapshotUnavailableError);
  });
});

describe('CLI: снимок из модуля проекта и собранный бинарь', () => {
  it('snapshot пишет, verify ловит устаревший снимок', () => {
    const module = join(root, 'contracts.js');
    const source = (extra: string): string => `
const { defineContract, createSnapshot } = require(${JSON.stringify(join(__dirname, '..', 'index'))});
const { z } = require(${JSON.stringify(require.resolve('zod'))});
module.exports.snapshot = () => createSnapshot({ writes: [defineContract({ name: 'job', version: '1.0.0', schema: z.object({ id: z.string()${extra} }) })] });
`;
    writeFileSync(module, source(''));
    expect(cli('snapshot', '--from', 'contracts.js', '--out', 'out/contracts.snapshot.json').code).toBe(0);
    expect(cli('verify', '--from', 'contracts.js', '--snapshot', 'out/contracts.snapshot.json').code).toBe(0);
    jest.resetModules();
    writeFileSync(module, source(', extra: z.number()'));
    const stale = cli('verify', '--from', 'contracts.js', '--snapshot', 'out/contracts.snapshot.json');
    expect([stale.code, stale.out]).toEqual([1, expect.stringContaining('устарел: job')]);
  });

  it('собранный бинарь: код выхода процесса — 0, 1 и 2', () => {
    if (!existsSync(DIST_CLI)) {
      throw new Error(`нет ${DIST_CLI}: сначала pnpm run build`);
    }
    const run = (...argv: string[]): number | null =>
      spawnSync(process.execPath, [DIST_CLI, ...argv], { cwd: root, encoding: 'utf8', timeout: 30_000 })
        .status;
    const mine = join(writerRepo, SNAPSHOT);
    expect(run('check', '--mine', mine, '--peer', mine, '--mode', 'mirror')).toBe(0);
    expect(run('check', '--mine', mine, '--peer', `git:${readerRepo}#main:${SNAPSHOT}`)).toBe(1);
    expect(run('check', '--mine', mine, '--peer', join(root, 'nope.json'))).toBe(2);
    expect(run('unknown-command')).toBe(2);
  });
});
