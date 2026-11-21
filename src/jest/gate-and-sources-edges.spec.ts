import childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import type { ZodLike } from '../index';
import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import { loadPeerSnapshot } from '../sources/load-peer-snapshot';
import { readDeployedRecord } from '../sources/read-deployed-record';
import { recordDeployed } from '../sources/record-deployed';
import { gitFixture } from '../testing/git-fixture';
import { runSource } from '../testing/run-source';
import { gateChecks } from './gate-checks';

/**
 * Гейт и источники снимка на краях: подпуть `./jest` вне jest, переписывание
 * снимка в CI, потолок времени на ВСЮ добычу снимка, хэш в верхнем регистре,
 * экспорт `ZodLike`.
 */
const root = mkdtempSync(join(tmpdir(), 'contracts-gate-edges-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('подпуть ./jest вне jest (vitest, node:test)', () => {
  it('импорт не бросает, проверки регистрируются своими describe/it', () => {
    const run = runSource(`
const gate = require(${JSON.stringify(join(__dirname, 'index.ts'))});
const names = [];
gate.contractsGate(
  { root: ${JSON.stringify(root)}, snapshot: () => lib.createSnapshot({}), committed: 'x.json', minContracts: 1 },
  { describe: (name, body) => { names.push('describe ' + name); body(); }, it: (name) => names.push('it ' + name) },
);
process.stdout.write(JSON.stringify(names));
`);
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([
      'describe контракты',
      'it снимок совпадает с закоммиченным (x.json)',
      'it выборка не выродилась: контрактов не меньше 1',
    ]);
  });
});

describe('гейт runtime: чтение, вернувшее Promise', () => {
  it('отклонение образца, а не молчаливое «прочитано»', () => {
    const writer = defineContract({
      name: 'p',
      version: '1.0.0',
      schema: z.object({ a: z.string() }),
      examples: [{ a: 'x' }],
    });
    const reader = defineContract({ name: 'p', version: '1.0.0', schema: z.object({ a: z.string() }) });
    writeFileSync(join(root, 'promise-peer.json'), serializeSnapshot(createSnapshot({ writes: [writer] })));
    const snapshot = () => createSnapshot({ reads: [reader] });
    writeFileSync(join(root, 'promise-mine.json'), serializeSnapshot(snapshot()));
    const asyncReader = {
      name: 'p',
      versionField: 'contractVersion',
      read: () => Promise.reject(new Error('асинхронно')),
    };
    const { checks } = gateChecks({
      root,
      snapshot,
      committed: 'promise-mine.json',
      minContracts: 1,
      runtime: [asyncReader],
      peers: [{ name: 'w', source: { kind: 'file', path: 'promise-peer.json' } }],
    });
    const violations = checks.find((check) => check.name.includes('нарушений вне известных')) as {
      run: () => void;
    };
    expect(() => violations.run()).toThrow(/example-rejected examples\[0\].*read вернул Promise/s);
  });
});

describe('CONTRACTS_UPDATE=1 в CI', () => {
  const contract = defineContract({ name: 'c', version: '1.0.0', schema: z.object({ a: z.string() }) });
  const snapshot = () => createSnapshot({ writes: [contract] });
  const committedCheck = () =>
    gateChecks({ root, snapshot, committed: 'ci.snapshot.json', minContracts: 1 }).checks[0] as {
      run: () => void;
    };
  const put = (key: string, value: string | undefined): void => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };
  const withEnv = (
    env: { readonly CONTRACTS_UPDATE?: string; readonly CI?: string | undefined },
    action: () => void,
  ): void => {
    const saved = { update: process.env.CONTRACTS_UPDATE, ci: process.env.CI };
    put('CONTRACTS_UPDATE', env.CONTRACTS_UPDATE);
    put('CI', env.CI);
    try {
      action();
    } finally {
      put('CONTRACTS_UPDATE', saved.update);
      put('CI', saved.ci);
    }
  };

  it('в CI — отказ, а не переписанный и тут же совпавший снимок', () => {
    withEnv({ CONTRACTS_UPDATE: '1', CI: 'true' }, () => {
      expect(() => committedCheck().run()).toThrow(/CONTRACTS_UPDATE=1 в CI/);
    });
  });

  it('контроль: локально (CI нет или CI=false) переписывает', () => {
    for (const ci of [undefined, 'false', '0']) {
      rmSync(join(root, 'ci.snapshot.json'), { force: true });
      withEnv({ CONTRACTS_UPDATE: '1', CI: ci }, () => {
        expect(() => committedCheck().run()).not.toThrow();
      });
      expect(readFileSync(join(root, 'ci.snapshot.json'), 'utf8')).toContain('"c"');
    }
  });
});

describe('потолок времени — на всю добычу снимка, а не на каждый вызов git', () => {
  it('каждый вызов git получает остаток; исчерпан — отказ до следующего вызова', () => {
    const calls: Array<{ readonly args: readonly string[]; readonly timeout: unknown }> = [];
    let clock = 1_000_000;
    // Работа сама двигает часы: каждый вызов git «занимает» 600 мс.
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    const spawn = jest.spyOn(childProcess, 'spawnSync').mockImplementation(((
      _command: string,
      args: readonly string[],
      options: { timeout?: number },
    ) => {
      calls.push({ args, timeout: options.timeout });
      clock += 600;
      return {
        status: 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
        pid: 1,
        output: [],
        signal: null,
      };
    }) as unknown as typeof childProcess.spawnSync);
    let error: unknown;
    try {
      loadPeerSnapshot(
        { kind: 'clone', url: 'https://example.invalid/r.git', ref: 'main', path: 'c.json' },
        { timeoutMs: 1000 },
      );
    } catch (caught) {
      error = caught;
    } finally {
      spawn.mockRestore();
      now.mockRestore();
    }
    // init — весь бюджет, fetch — остаток 400 мс, show не вызывается: бюджет исчерпан.
    expect(calls.map((call) => [call.args[0], call.timeout])).toEqual([
      ['init', 1000],
      ['fetch', 400],
    ]);
    expect(error).toBeInstanceOf(PeerSnapshotUnavailableError);
    expect(String((error as Error).message)).toMatch(/потолок времени 1000 мс/);
  });
});

describe('запись о развёрнутой ревизии: хэш в верхнем регистре — тот же коммит', () => {
  it('recordDeployed и readDeployedRecord приводят к нижнему регистру', () => {
    const upper = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const file = join(root, 'rec.json');
    expect(recordDeployed(file, { peer: 'p', ref: upper, snapshotPath: 's.json' }).ref).toBe(
      upper.toLowerCase(),
    );
    writeFileSync(
      file,
      JSON.stringify({
        format: 'contracts-deployed/1',
        peer: 'p',
        ref: upper,
        snapshotPath: 's.json',
      }),
    );
    expect(readDeployedRecord(file).ref).toBe(upper.toLowerCase());
    writeFileSync(
      file,
      JSON.stringify({
        format: 'contracts-deployed/1',
        peer: 'p',
        ref: 'main',
        snapshotPath: 's.json',
      }),
    );
    expect(() => readDeployedRecord(file)).toThrow('не полный хэш');
  });
});

describe('ZodLike экспортирован из корня', () => {
  it('обёртку над defineContract можно типизировать без Contract<O, I, W>', () => {
    const wrap = <S extends ZodLike>(schema: S) => defineContract({ name: 'w', version: '1.0.0', schema });
    expect(wrap(z.object({ a: z.string() })).name).toBe('w');
    expect(serializeSnapshot(createSnapshot({ writes: [wrap(z.object({ a: z.string() }))] }))).toContain(
      '"w"',
    );
  });
});

describe('fetch по хэшу коммита, который не вершина ветки (локальный bare-репозиторий, file://)', () => {
  const peerSnapshot = (version: string): string =>
    serializeSnapshot(
      createSnapshot({
        writes: [defineContract({ name: 'c', version, schema: z.object({ a: z.string() }) })],
      }),
    );
  const work = join(root, 'sha-work');
  gitFixture.init(work);
  const old = gitFixture.commit(work, { 'c.json': peerSnapshot('1.0.0') }, 'one');
  gitFixture.commit(work, { 'c.json': peerSnapshot('1.1.0') }, 'two');
  const bare = join(root, 'sha-bare.git');
  childProcess.execFileSync('git', ['clone', '-q', '--bare', work, bare], { timeout: 30_000 });
  const url = `file://${bare}`;
  const withProtocol = <T>(version: string | undefined, action: () => T): T => {
    const keys = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'] as const;
    const saved = keys.map((key) => process.env[key]);
    if (version !== undefined) {
      process.env.GIT_CONFIG_COUNT = '1';
      process.env.GIT_CONFIG_KEY_0 = 'protocol.version';
      process.env.GIT_CONFIG_VALUE_0 = version;
    }
    try {
      return action();
    } finally {
      keys.forEach((key, index) => {
        if (saved[index] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[index];
        }
      });
    }
  };

  it('протокол v2 отдаёт достижимый коммит по хэшу — снимок той ревизии', () => {
    const document = withProtocol(undefined, () =>
      loadPeerSnapshot({ kind: 'clone', url, ref: old, path: 'c.json' }, { timeoutMs: 30_000 }),
    );
    expect(document.contracts.c?.version).toBe('1.0.0');
  });

  it('протокол v0 без uploadpack.allowReachableSHA1InWant — «не проверено», а не чужая ревизия', () => {
    expect(() =>
      withProtocol('0', () =>
        loadPeerSnapshot({ kind: 'clone', url, ref: old, path: 'c.json' }, { timeoutMs: 30_000 }),
      ),
    ).toThrow(PeerSnapshotUnavailableError);
  });

  it('протокол v0 с uploadpack.allowReachableSHA1InWant=true — снимок той ревизии', () => {
    childProcess.execFileSync('git', ['-C', bare, 'config', 'uploadpack.allowReachableSHA1InWant', 'true']);
    try {
      const document = withProtocol('0', () =>
        loadPeerSnapshot({ kind: 'clone', url, ref: old, path: 'c.json' }, { timeoutMs: 30_000 }),
      );
      expect(document.contracts.c?.version).toBe('1.0.0');
    } finally {
      childProcess.execFileSync('git', [
        '-C',
        bare,
        'config',
        '--unset',
        'uploadpack.allowReachableSHA1InWant',
      ]);
    }
  });
});
