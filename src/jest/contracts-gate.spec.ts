import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';

/**
 * Гейт — тонкая обёртка, регистрирующая describe/it в спеке ПРОЕКТА.
 * Проверяется ИСХОДНИК (не собранный dist: правка исходника иначе не
 * проверялась бы ничем до сборки) настоящим jest на проекте-фикстуре: что
 * зелёное проходит, что каждое расхождение роняет РОВНО свою проверку и что
 * `CONTRACTS_UPDATE=1` переписывает снимок. Логику проверок отдельно и в
 * процессе проверяет `gate-checks.spec.ts`.
 */
const PACKAGE = join(__dirname, '..', '..');
const SOURCE = join(PACKAGE, 'src');
const JEST = join(PACKAGE, 'node_modules', '.bin', 'jest');

const root = mkdtempSync(join(tmpdir(), 'contracts-gate-'));
const PEER = join(root, 'peer.snapshot.json');

const GATE_SPEC = `
const { contractsGate } = require(${JSON.stringify(join(SOURCE, 'jest', 'index.ts'))});
const { defineContract, createSnapshot } = require(${JSON.stringify(join(SOURCE, 'index.ts'))});
const { z } = require(${JSON.stringify(require.resolve('zod'))});
let id = z.string();
if (process.env.REFINE === '1') id = id.refine((value) => value !== 'forbidden', 'запрещённый id');
const shape = { id, hosts: z.array(z.string()) };
if (process.env.EXTRA === '1') shape.trace = z.string();
const task = defineContract({ name: 'task', version: '1.0.0', schema: z.object(shape), wire: { queue: 'tasks' } });
// Долгая сборка снимка (компилятор TypeScript на холодной машине) — синхронная блокировка.
const SLOW_MS = Number(process.env.SLOW_MS ?? 0);
const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (process.env.ASYNC_CONTROL === '1') {
  it('контроль: асинхронная проверка дольше таймаута', () => new Promise((done) => setTimeout(done, SLOW_MS)));
}
contractsGate({
  root: ${JSON.stringify(root)},
  snapshot: () => {
    if (SLOW_MS > 0) block(SLOW_MS);
    return createSnapshot({ reads: [task] });
  },
  committed: 'contracts.snapshot.json',
  minContracts: Number(process.env.MIN ?? 1),
  peers: [{ name: 'писатель', source: { kind: 'file', path: process.env.PEER }, known: JSON.parse(process.env.KNOWN ?? '{}') }],
  runtime: [task],
});
`;

interface Outcome {
  readonly status: number | null;
  readonly failed: string[];
  readonly passed: number;
  readonly suiteError: string;
}

const run = (env: Record<string, string> = {}): Outcome => {
  writeFileSync(join(root, 'gate.spec.js'), GATE_SPEC);
  const config = join(root, 'jest.config.json');
  writeFileSync(
    config,
    JSON.stringify({
      rootDir: root,
      testMatch: ['**/gate.spec.js'],
      testEnvironment: 'node',
      moduleFileExtensions: ['js', 'ts', 'json'],
      transform: {
        '^.+\\.ts$': [
          require.resolve('ts-jest'),
          { tsconfig: join(PACKAGE, 'tsconfig.json'), isolatedModules: true },
        ],
      },
      ...(env.TEST_TIMEOUT === undefined ? {} : { testTimeout: Number(env.TEST_TIMEOUT) }),
    }),
  );
  const report = join(root, 'report.json');
  rmSync(report, { force: true });
  const child = spawnSync(
    JEST,
    // `--projects root`: jest 30.5.2 с `--config` ищет ещё и конфиг вверх от каталога процесса и без
    // него падает «Could not find a config file» (30.1 — нет), а у случая «каталог процесса — не root» его там нет.
    ['--config', config, '--projects', root, '--json', '--outputFile', report, '--maxWorkers=1', '--ci'],
    {
      cwd: env.CWD ?? root,
      encoding: 'utf8',
      env: { ...process.env, PEER, ...env },
      timeout: 50_000,
    },
  );
  const parsed = JSON.parse(readFileSync(report, 'utf8')) as {
    testResults: Array<{ message: string; assertionResults: Array<{ fullName: string; status: string }> }>;
  };
  const results = parsed.testResults.flatMap((suite) => suite.assertionResults);
  return {
    status: child.status,
    failed: results.filter((result) => result.status === 'failed').map((result) => result.fullName),
    passed: results.filter((result) => result.status === 'passed').length,
    suiteError: parsed.testResults.map((suite) => suite.message).join('\n'),
  };
};

const writerSnapshot = (examples: unknown[]): string =>
  serializeSnapshot(
    createSnapshot({
      writes: [
        defineContract({
          name: 'task',
          version: '1.1.0',
          schema: z.object({ id: z.string(), hosts: z.array(z.string()), weight: z.number().optional() }),
          wire: { queue: 'tasks' },
          examples,
        }),
      ],
    }),
  );

const TITLES = {
  committed: 'контракты снимок совпадает с закоммиченным (contracts.snapshot.json)',
  sample: 'контракты выборка не выродилась: контрактов не меньше 1',
  fetched: `контракты писатель: снимок другой стороны добыт (file:${PEER})`,
  compatible: 'контракты писатель: совместимость (compatible): нарушений вне известных расхождений нет',
  unproven: 'контракты писатель: совместимость (compatible): «не доказано» вне известных расхождений нет',
  known: 'контракты писатель: совместимость (compatible): известные расхождения — с причиной и всё ещё есть',
};

beforeAll(() => {
  writeFileSync(PEER, writerSnapshot([{ id: 'forbidden', hosts: [] }]));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('contractsGate на проекте-фикстуре', () => {
  it('нет закоммиченного снимка — красная только его проверка; CONTRACTS_UPDATE=1 пишет его', () => {
    expect(run()).toMatchObject({ status: 1, failed: [TITLES.committed], passed: 4 });
    expect(run({ CONTRACTS_UPDATE: '1' })).toMatchObject({ status: 0, failed: [], passed: 5 });
    expect(readFileSync(join(root, 'contracts.snapshot.json'), 'utf8')).toContain('"role": "reader"');
    expect(run()).toMatchObject({ status: 0, failed: [], passed: 5 });
  });

  it('контракт изменился в коде — красные «снимок устарел» и совместимость с писателем', () => {
    expect(run({ EXTRA: '1' })).toMatchObject({
      status: 1,
      failed: [TITLES.committed, TITLES.compatible],
      passed: 3,
    });
  });

  it('снимок другой стороны не добыт — красный, а не пропуск', () => {
    expect(run({ PEER: join(root, 'nope.json') })).toMatchObject({
      status: 1,
      failed: [TITLES.fetched.replace(PEER, join(root, 'nope.json')), TITLES.compatible, TITLES.unproven],
    });
  });

  it('refine читателя: в снимке — «не доказано», образец писателя отвергает рантайм-разбор', () => {
    expect(run({ REFINE: '1', CONTRACTS_UPDATE: '1' })).toMatchObject({
      status: 1,
      failed: [TITLES.compatible, TITLES.unproven],
      passed: 3,
    });
  });

  it('известное расхождение допускает нарушение; устаревшее — красное', () => {
    const reason = 'читатель переходит на новую схему в следующем релизе, до тех пор допущено';
    const known = { 'task example-rejected examples[0]': reason, 'task not-proven id': reason };
    expect(run({ REFINE: '1', KNOWN: JSON.stringify(known) })).toMatchObject({
      status: 0,
      failed: [],
      passed: 6,
    });
    // Снимок без refine: обе записи устарели.
    expect(run({ CONTRACTS_UPDATE: '1', KNOWN: JSON.stringify(known) })).toMatchObject({
      status: 1,
      failed: [TITLES.known],
    });
  });

  it('долгая сборка снимка не упирается в таймаут jest: проверки гейта синхронны', () => {
    // Контроль в той же фикстуре: асинхронная проверка той же длины таймаут ловит —
    // значит, потолок действует, а синхронный гейт его не касается.
    const slow = { SLOW_MS: '800', TEST_TIMEOUT: '200' };
    expect(run(slow)).toMatchObject({ status: 0, failed: [], passed: 5 });
    expect(run({ ...slow, ASYNC_CONTROL: '1' })).toMatchObject({
      status: 1,
      failed: ['контроль: асинхронная проверка дольше таймаута'],
      passed: 5,
    });
  });

  it('относительный путь источника — от root гейта, а не от каталога процесса jest', () => {
    expect(run({ PEER: 'peer.snapshot.json', CWD: tmpdir() })).toMatchObject({ status: 0, failed: [] });
  });

  it('minContracts 0 — отказ регистрации гейта', () => {
    const outcome = run({ MIN: '0' });
    expect([outcome.status, outcome.suiteError]).toEqual([
      1,
      expect.stringContaining('minContracts обязан быть не меньше 1'),
    ]);
  });
});
