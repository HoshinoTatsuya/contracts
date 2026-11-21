import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { z } from 'zod';

import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import { exportTree } from '../sources/export-tree';
import { loadPeerSnapshot } from '../sources/load-peer-snapshot';
import { gitFixture } from '../testing/git-fixture';
import { runCli } from './run-cli';

/**
 * CLI и источники на входе из конфигурации CI: опечатка в выборке, повтор
 * флага, ревизия и путь, начинающиеся с дефиса.
 */
const root = mkdtempSync(join(tmpdir(), 'contracts-cli-hardening-'));
const repo = join(root, 'repo');
const task = (schema: z.ZodType) => defineContract({ name: 'scan-task', version: '1.0.0', schema });

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

beforeAll(() => {
  writeFileSync(
    join(root, 'w.json'),
    serializeSnapshot(createSnapshot({ writes: [task(z.object({ id: z.string() }))] })),
  );
  writeFileSync(
    join(root, 'r.json'),
    serializeSnapshot(createSnapshot({ reads: [task(z.object({ id: z.number() }))] })),
  );
  gitFixture.init(repo);
  gitFixture.commit(
    repo,
    {
      'contracts.snapshot.json': serializeSnapshot(
        createSnapshot({ reads: [task(z.object({ id: z.string() }))] }),
      ),
    },
    'x',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('CLI: выборка и флаги', () => {
  it('контроль: без --only несовместимость видна (код 1)', () => {
    expect(cli('check', '--mine', 'w.json', '--peer', 'r.json').code).toBe(1);
  });

  it('--only с опечаткой — НЕ ПРОВЕРЕНО, а не «совместимо»', () => {
    expect(cli('check', '--mine', 'w.json', '--peer', 'r.json', '--only', 'scan-taks').code).toBe(2);
  });

  it('--only из одних запятых — НЕ ПРОВЕРЕНО', () => {
    expect(cli('check', '--mine', 'w.json', '--peer', 'r.json', '--only', ',').code).toBe(2);
  });

  it('повтор флага — отказ, а не «последний победил»', () => {
    const outcome = cli(
      'check',
      '--mine',
      'w.json',
      '--peer',
      'r.json',
      '--mode',
      'mirror',
      '--mode',
      'compatible',
    );
    expect(outcome.code).toBe(2);
    expect(outcome.out).toContain('--mode');
  });
});

describe('git: аргументы с ведущим дефисом', () => {
  it('ревизия — отказ, файла по --output нет', () => {
    const marker = join(root, 'written-by-ref');
    const outcome = cli(
      'check',
      '--mine',
      'w.json',
      '--peer',
      `git:repo#--output=${marker}:contracts.snapshot.json`,
    );
    expect(outcome.code).toBe(2);
    expect(readdirSync(root).filter((name) => name.startsWith('written-by-ref'))).toEqual([]);
  });

  it('адрес удалённого репозитория — отказ до вызова git', () => {
    expect(() =>
      loadPeerSnapshot({ kind: 'clone', url: '--depth=1', ref: 'HEAD', path: 'contracts.snapshot.json' }),
    ).toThrow('начинается с «-»');
  });

  it('путь — отказ', () => {
    expect(() => loadPeerSnapshot({ kind: 'git', repo, ref: 'HEAD', path: '-x' })).toThrow(
      PeerSnapshotUnavailableError,
    );
  });

  it('exportTree: ревизия — отказ, архива нет', () => {
    const archive = join(root, 'archive-by-ref.tar');
    expect(() => exportTree(repo, `--output=${archive}`)).toThrow(PeerSnapshotUnavailableError);
    expect(existsSync(archive)).toBe(false);
  });

  it('контроль: обычная ревизия читается', () => {
    const document = loadPeerSnapshot({ kind: 'git', repo, ref: 'HEAD', path: 'contracts.snapshot.json' });
    expect(Object.keys(document.contracts)).toEqual(['scan-task']);
  });
});

/**
 * Второй рубеж отдельно от первого: позиционные аргументы git отделены
 * `--end-of-options` (заглушка git на PATH записывает свои аргументы). Без
 * этой проверки снятие `--end-of-options` маскировал бы отказ по ведущему «-».
 */
describe('git: позиционные аргументы после --end-of-options', () => {
  const unix = process.platform === 'win32' ? it.skip : it;
  const stub = join(root, 'stub-bin');
  const log = join(root, 'git-args.log');
  const run = (call: () => unknown): string[] => {
    rmSync(log, { force: true });
    const saved = process.env.PATH;
    process.env.PATH = `${stub}${delimiter}${saved ?? ''}`;
    try {
      call();
    } catch {
      // Заглушка отвечает отказом: важны аргументы, с которыми её вызвали.
    } finally {
      process.env.PATH = saved;
    }
    return existsSync(log) ? readFileSync(log, 'utf8').split('\n') : [];
  };
  const positional = (args: readonly string[]): string | undefined =>
    args[args.indexOf('--end-of-options') + 1];

  beforeAll(() => {
    mkdirSync(stub, { recursive: true });
    writeFileSync(
      join(stub, 'git'),
      `#!/bin/sh\nif [ "$1" = "init" ]; then exit 0; fi\nfor a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\nexit 1\n`,
    );
    chmodSync(join(stub, 'git'), 0o755);
  });

  unix('show [на Windows пропущено: заглушка git — shell-скрипт]', () => {
    const args = run(() =>
      loadPeerSnapshot({ kind: 'git', repo, ref: 'HEAD', path: 'contracts.snapshot.json' }),
    );
    expect(positional(args)).toBe('HEAD:contracts.snapshot.json');
  });

  unix('fetch [на Windows пропущено: заглушка git — shell-скрипт]', () => {
    const args = run(() =>
      loadPeerSnapshot({ kind: 'clone', url: 'https://example.invalid/r.git', ref: 'main', path: 'c.json' }),
    );
    expect([positional(args), args.includes('fetch')]).toEqual(['https://example.invalid/r.git', true]);
  });

  unix('archive [на Windows пропущено: заглушка git — shell-скрипт]', () => {
    const args = run(() => exportTree(repo, 'HEAD'));
    expect([positional(args), args.includes('archive')]).toEqual(['HEAD', true]);
  });
});
