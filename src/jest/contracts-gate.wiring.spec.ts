import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { contractsGate } from './contracts-gate';

/**
 * Регистрация гейта в процессе спеки: вместо `describe`/`it` jest передан
 * регистратор, записывающий вызовы (так же гейт подключается к vitest). Проверяется, что заголовок и каждая проверка
 * `gateChecks` становятся ровно своим `it`, а тело `it` исполняет проверку.
 */
const registered: Array<{
  readonly kind: 'describe' | 'it';
  readonly name: string;
  readonly body: () => void;
}> = [];
const recorder = {
  describe: (name: string, body: () => void): void => {
    registered.push({ kind: 'describe', name, body });
    body();
  },
  it: (name: string, body: () => void): void => {
    registered.push({ kind: 'it', name, body });
  },
};

const root = mkdtempSync(join(tmpdir(), 'contracts-gate-wiring-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('contractsGate: регистрация', () => {
  it('один describe с заголовком и по it на каждую проверку; тело it исполняет проверку', () => {
    registered.length = 0;
    const task = defineContract({ name: 'task', version: '1.0.0', schema: z.object({ id: z.string() }) });
    contractsGate(
      {
        title: 'мои контракты',
        root,
        snapshot: () => createSnapshot({ reads: [task] }),
        committed: 'none.json',
        minContracts: 1,
      },
      recorder,
    );
    expect(registered.map(({ kind, name }) => `${kind} ${name}`)).toEqual([
      'describe мои контракты',
      'it снимок совпадает с закоммиченным (none.json)',
      'it выборка не выродилась: контрактов не меньше 1',
    ]);
    expect(() => registered[1]?.body()).toThrow('нет закоммиченного снимка none.json');
    expect(() => registered[2]?.body()).not.toThrow();
  });

  it('minContracts 0 — отказ до регистрации', () => {
    registered.length = 0;
    expect(() =>
      contractsGate(
        { root, snapshot: () => createSnapshot({}), committed: 'x.json', minContracts: 0 },
        recorder,
      ),
    ).toThrow('minContracts');
    expect(registered).toEqual([]);
  });
});
