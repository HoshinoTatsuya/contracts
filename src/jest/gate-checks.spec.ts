import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import type { ContractsGateOptions } from '../types/contracts-gate-options.type';
import type { GateCheck } from '../types/gate-check.type';
import { gateChecks } from './gate-checks';

/**
 * Логика гейта — в процессе спеки, на исходнике: каждая проверка на
 * зелёном случае и на своём красном, с текстом причины. Регистрацию в jest
 * отдельно проверяет `contracts-gate.spec.ts` на проекте-фикстуре.
 */
let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'contracts-gate-checks-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env[CONTRACT_FORMAT.UPDATE_ENV];
});

const reader = (schema: z.ZodType = z.object({ id: z.string() })) =>
  defineContract({ name: 'task', version: '1.0.0', schema });
const writerSnapshot = (schema: z.ZodType, examples: unknown[] = []) =>
  serializeSnapshot(
    createSnapshot({ writes: [defineContract({ name: 'task', version: '1.0.0', schema, examples })] }),
  );
const run = (check: GateCheck | undefined): string => {
  if (check === undefined) {
    return 'нет проверки';
  }
  try {
    check.run();
    return 'ok';
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
};
const byName = (checks: readonly GateCheck[], part: string): GateCheck | undefined =>
  checks.find((check) => check.name.includes(part));
const options = (over: Partial<ContractsGateOptions> = {}): ContractsGateOptions => ({
  root,
  snapshot: () => createSnapshot({ reads: [reader()] }),
  committed: 'contracts.snapshot.json',
  minContracts: 1,
  ...over,
});
const commit = (document: string): void => {
  writeFileSync(join(root, 'contracts.snapshot.json'), document);
};

describe('gateChecks: состав', () => {
  it('имена проверок — по порядку; заголовок по умолчанию и свой', () => {
    writeFileSync(join(root, 'prev.json'), serializeSnapshot(createSnapshot({ reads: [reader()] })));
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.string() })));
    const gate = gateChecks(
      options({
        previous: { source: { kind: 'file', path: 'prev.json' } },
        peers: [
          {
            name: 'писатель',
            source: { kind: 'file', path: 'peer.json' },
            mode: 'aligned',
            known: { 'task field-unread x': 'причина длиннее тридцати символов ради проверки' },
          },
        ],
      }),
    );
    expect(gate.title).toBe('контракты');
    expect(gate.checks.map((check) => check.name)).toEqual([
      'снимок совпадает с закоммиченным (contracts.snapshot.json)',
      'выборка не выродилась: контрактов не меньше 1',
      'изменение против file:prev.json: прежний снимок добыт',
      'изменение против file:prev.json: нарушений вне известных расхождений нет',
      'изменение против file:prev.json: «не доказано» вне известных расхождений нет',
      'писатель: снимок другой стороны добыт (file:peer.json)',
      'писатель: совместимость (aligned): нарушений вне известных расхождений нет',
      'писатель: совместимость (aligned): «не доказано» вне известных расхождений нет',
      'писатель: совместимость (aligned): известные расхождения — с причиной и всё ещё есть',
    ]);
    expect(gateChecks(options({ title: 'мои' })).title).toBe('мои');
    expect(gateChecks(options()).checks).toHaveLength(2);
  });

  it('известные расхождения не заданы или пусты — своей проверки нет', () => {
    for (const known of [undefined, {}]) {
      const names = gateChecks(
        options({
          peers: [
            {
              name: 'писатель',
              source: { kind: 'file', path: 'peer.json' },
              ...(known === undefined ? {} : { known }),
            },
          ],
        }),
      ).checks.map((check) => check.name);
      expect(names).toEqual([
        'снимок совпадает с закоммиченным (contracts.snapshot.json)',
        'выборка не выродилась: контрактов не меньше 1',
        'писатель: снимок другой стороны добыт (file:peer.json)',
        'писатель: совместимость (compatible): нарушений вне известных расхождений нет',
        'писатель: совместимость (compatible): «не доказано» вне известных расхождений нет',
      ]);
    }
  });

  it.each([0, -1, Number.NaN])('minContracts %p — отказ регистрации', (minContracts) => {
    expect(() => gateChecks(options({ minContracts }))).toThrow('minContracts обязан быть не меньше 1');
  });
});

describe('gateChecks: снимок и выборка', () => {
  it('нет закоммиченного снимка — красная; CONTRACTS_UPDATE=1 записывает через форматтер; совпал — зелёная', () => {
    // Запись снимка разрешена только вне CI (отказ в CI — отдельная проверка): переменную CI раннера убрать.
    const savedCi = process.env.CI;
    delete process.env.CI;
    try {
      const [committed] = gateChecks(options()).checks;
      expect(run(committed)).toBe(
        'Error: нет закоммиченного снимка contracts.snapshot.json: собрать — CONTRACTS_UPDATE=1',
      );
      process.env[CONTRACT_FORMAT.UPDATE_ENV] = '1';
      const formatted: string[] = [];
      const [updating] = gateChecks(options({ formatter: (file) => formatted.push(file) })).checks;
      expect(run(updating)).toBe('ok');
      expect(formatted).toEqual([join(root, 'contracts.snapshot.json')]);
      process.env[CONTRACT_FORMAT.UPDATE_ENV] = '0';
      expect(run(gateChecks(options()).checks[0])).toBe('ok');
    } finally {
      if (savedCi === undefined) delete process.env.CI;
      else process.env.CI = savedCi;
    }
  });

  it('снимок устарел — красная с именем контракта', () => {
    commit(serializeSnapshot(createSnapshot({ reads: [reader(z.object({ id: z.number() }))] })));
    expect(run(gateChecks(options()).checks[0])).toBe(
      'Error: снимок contracts.snapshot.json устарел: task — пересобрать (CONTRACTS_UPDATE=1)',
    );
  });

  it('контракт только в закоммиченном — тоже устарел', () => {
    commit(
      serializeSnapshot(
        createSnapshot({
          reads: [reader(), defineContract({ name: 'gone', version: '1.0.0', schema: z.object({}) })],
        }),
      ),
    );
    expect(run(gateChecks(options()).checks[0])).toContain('устарел: gone —');
  });

  it('устаревшие контракты перечислены по имени, по порядку', () => {
    const named = (name: string) => defineContract({ name, version: '1.0.0', schema: z.object({}) });
    commit(serializeSnapshot(createSnapshot({ reads: [reader(), named('zeta')] })));
    const checks = gateChecks(
      options({ snapshot: () => createSnapshot({ reads: [reader(), named('alpha')] }) }),
    ).checks;
    expect(run(checks[0])).toBe(
      'Error: снимок contracts.snapshot.json устарел: alpha, zeta — пересобрать (CONTRACTS_UPDATE=1)',
    );
  });

  it('выборка выродилась — красная с числом', () => {
    const checks = gateChecks(options({ minContracts: 2 })).checks;
    expect(run(checks[1])).toBe('Error: контрактов в снимке 1, ожидалось не меньше 2');
    expect(run(gateChecks(options({ minContracts: 1 })).checks[1])).toBe('ok');
  });

  it('снимок своей стороны собирается один раз на все проверки', () => {
    let calls = 0;
    commit(serializeSnapshot(createSnapshot({ reads: [reader()] })));
    const checks = gateChecks(
      options({
        snapshot: () => {
          calls += 1;
          return createSnapshot({ reads: [reader()] });
        },
      }),
    ).checks;
    for (const check of checks) {
      check.run();
    }
    expect(calls).toBe(1);
  });
});

describe('gateChecks: другая сторона', () => {
  type Peer = NonNullable<ContractsGateOptions['peers']>[number];
  const peerChecks = (over: Partial<Peer> = {}, base: Partial<ContractsGateOptions> = {}) =>
    gateChecks(
      options({
        peers: [{ name: 'писатель', source: { kind: 'file', path: 'peer.json' }, ...over }],
        ...base,
      }),
    ).checks;

  it('снимок не добыт — красные «добыт» и совместимость, а не пропуск', () => {
    const checks = peerChecks();
    expect(run(byName(checks, 'снимок другой стороны добыт'))).toMatch(/^PeerSnapshotUnavailableError: /);
    expect(() => byName(checks, 'нарушений')?.run()).toThrow(PeerSnapshotUnavailableError);
    expect(() => byName(checks, '«не доказано»')?.run()).toThrow(PeerSnapshotUnavailableError);
  });

  it('совместимо — все зелёные; относительный путь — от root', () => {
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.string() })));
    const checks = peerChecks();
    expect(checks.slice(2).map(run)).toEqual(['ok', 'ok', 'ok']);
  });

  it('добытый снимок кэшируется: файл исчез после первой проверки — проверки не падают', () => {
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.string() })));
    const checks = peerChecks();
    expect(run(byName(checks, 'добыт'))).toBe('ok');
    unlinkSync(join(root, 'peer.json'));
    expect(run(byName(checks, 'нарушений'))).toBe('ok');
  });

  it('нарушение — красная с адресом находки; «не доказано» — своя проверка', () => {
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.number() })));
    const checks = peerChecks();
    expect(run(byName(checks, 'нарушений'))).toContain('нарушений 1:\n  task type-changed id — ');
    expect(run(byName(checks, '«не доказано»'))).toBe('ok');
  });

  it('нарушения — по строке на находку, с метками сторон', () => {
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.number(), n: z.number() })));
    const checks = peerChecks(
      {},
      { snapshot: () => createSnapshot({ reads: [reader(z.object({ id: z.string(), n: z.string() }))] }) },
    );
    expect(run(byName(checks, 'нарушений'))).toBe(
      [
        'Error: писатель: совместимость (compatible): нарушений 2:',
        '  task type-changed id — писатель пишет → здесь читает: «id»: писатель шлёт число, читатель ждёт строка',
        '  task type-changed n — писатель пишет → здесь читает: «n»: писатель шлёт число, читатель ждёт строка',
      ].join('\n'),
    );
  });

  it('известные: несколько устаревших и несколько без причины — все по именам', () => {
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.number(), n: z.number() })));
    const reason = 'читатель переходит на число в следующем релизе, до тех пор допущено';
    const checks = peerChecks(
      {
        known: {
          'task type-changed id': 'коротко',
          'task type-changed n': 'коротко',
          'task field-unread x': reason,
          'task field-unread y': reason,
        },
      },
      { snapshot: () => createSnapshot({ reads: [reader(z.object({ id: z.string(), n: z.string() }))] }) },
    );
    expect(run(byName(checks, 'известные'))).toBe(
      'Error: писатель: совместимость (compatible): устарели — task field-unread x, task field-unread y; без причины — task type-changed id, task type-changed n',
    );
  });

  it('«не доказано» — красная своя проверка, нарушения — зелёная', () => {
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.string() })));
    const checks = peerChecks(
      {},
      { snapshot: () => createSnapshot({ reads: [reader(z.object({ id: z.string().refine(Boolean) }))] }) },
    );
    expect(run(byName(checks, 'нарушений'))).toBe('ok');
    expect(run(byName(checks, '«не доказано»'))).toContain('не доказано 1:\n  task not-proven id — ');
  });

  it('известное расхождение допускает нарушение; устаревшее и без причины — красные', () => {
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.number() })));
    const reason = 'читатель переходит на число в следующем релизе, до тех пор допущено';
    const covered = peerChecks({ known: { 'task type-changed id': reason } });
    expect([run(byName(covered, 'нарушений')), run(byName(covered, 'известные'))]).toEqual(['ok', 'ok']);
    const stale = peerChecks({ known: { 'task type-changed id': reason, 'task field-unread x': reason } });
    expect(run(byName(stale, 'известные'))).toBe(
      'Error: писатель: совместимость (compatible): устарели — task field-unread x; без причины — нет',
    );
    const short = peerChecks({ known: { 'task type-changed id': 'коротко' } });
    expect(run(byName(short, 'известные'))).toBe(
      'Error: писатель: совместимость (compatible): устарели — нет; без причины — task type-changed id',
    );
    const longEnough = peerChecks({ known: { 'task type-changed id': 'коротко' } }, { minReasonLength: 3 });
    expect(run(byName(longEnough, 'известные'))).toBe('ok');
  });

  it('runtime: образец писателя разбирается настоящей схемой читателя (с версией в payload)', () => {
    writeFileSync(
      join(root, 'peer.json'),
      writerSnapshot(z.object({ id: z.string() }), [{ id: 'forbidden' }, { id: 'ok' }]),
    );
    const refined = reader(z.object({ id: z.string().refine((value) => value !== 'forbidden', 'запрещён') }));
    const checks = peerChecks(
      { known: { 'task not-proven id': 'refine проверяется образцами в этой же проверке' } },
      {
        snapshot: () => createSnapshot({ reads: [refined] }),
        runtime: [refined],
      },
    );
    const outcome = run(byName(checks, 'нарушений'));
    expect(outcome).toContain(
      'task example-rejected examples[0] — писатель пишет → здесь читает: схема читателя отвергла образец #1: ',
    );
    expect(outcome).not.toContain('examples[1]');
  });

  it('runtime: своя сторона только пишет — образцы другой стороны не разбираются', () => {
    writeFileSync(
      join(root, 'peer.json'),
      serializeSnapshot(
        createSnapshot({
          both: [
            defineContract({
              name: 'task',
              version: '1.0.0',
              schema: z.object({ id: z.string() }),
              examples: [{ id: 'x' }],
            }),
          ],
        }),
      ),
    );
    const strict = reader(z.object({ id: z.string().refine(() => false, 'всё запрещено') }));
    const writerSide = defineContract({
      name: 'task',
      version: '1.0.0',
      schema: z.object({ id: z.string() }),
    });
    const checks = peerChecks(
      {},
      { snapshot: () => createSnapshot({ writes: [writerSide] }), runtime: [strict] },
    );
    expect(run(byName(checks, 'нарушений'))).toBe('ok');
  });

  it('runtime: поле версии null — образец едет без версии', () => {
    // Строгая схема: лишний ключ (поле версии под именем «null») отвергается.
    const plain = defineContract({
      name: 'task',
      version: '1.0.0',
      schema: z.strictObject({ id: z.string() }),
      versionField: null,
    });
    writeFileSync(
      join(root, 'peer.json'),
      serializeSnapshot(
        createSnapshot({
          writes: [
            defineContract({
              name: 'task',
              version: '1.0.0',
              schema: z.object({ id: z.string() }),
              versionField: null,
              examples: [{ id: 'x' }],
            }),
          ],
        }),
      ),
    );
    const checks = peerChecks({}, { snapshot: () => createSnapshot({ reads: [plain] }), runtime: [plain] });
    expect(run(byName(checks, 'нарушений'))).toBe('ok');
  });

  it('runtime: контракта нет у одной из сторон — образцы не разбираются, а не TypeError', () => {
    const named = (name: string, examples: unknown[] = []) =>
      defineContract({ name, version: '1.0.0', schema: z.object({ id: z.string() }), examples });
    const rejectAll = defineContract({
      name: 'other',
      version: '1.0.0',
      schema: z.object({ id: z.string().refine(() => false, 'всё запрещено') }),
    });
    // Есть у другой стороны, нет у своей: нарушение сверки «нет контракта» — и только оно.
    writeFileSync(
      join(root, 'peer.json'),
      serializeSnapshot(createSnapshot({ writes: [named('task'), named('other', [{ id: 'x' }])] })),
    );
    const theirsOnly = peerChecks({}, { runtime: [rejectAll] });
    expect(run(byName(theirsOnly, 'нарушений'))).toBe(
      'Error: писатель: совместимость (compatible): нарушений 1:\n  other contract-missing (корень) — контракт есть писатель, нет здесь',
    );
    // Есть у своей, нет у другой: нарушение сверки «нет контракта», без разбора образцов.
    writeFileSync(join(root, 'peer.json'), serializeSnapshot(createSnapshot({ writes: [named('task')] })));
    const oursOnly = peerChecks(
      {},
      { snapshot: () => createSnapshot({ reads: [reader(), rejectAll] }), runtime: [rejectAll] },
    );
    const outcome = run(byName(oursOnly, 'нарушений'));
    expect(outcome).toMatch(
      /^Error: писатель: совместимость \(compatible\): нарушений 1:\n {2}other contract-missing /,
    );
    expect(outcome).not.toContain('example-rejected');
  });

  it('runtime: другая сторона только читает — её образцы не разбираются', () => {
    writeFileSync(
      join(root, 'peer.json'),
      serializeSnapshot(
        createSnapshot({
          reads: [
            defineContract({
              name: 'task',
              version: '1.0.0',
              schema: z.object({ id: z.string() }),
              examples: [{ id: 'x' }],
            }),
          ],
        }),
      ),
    );
    const strict = reader(z.object({ id: z.string().refine(() => false, 'всё запрещено') }));
    const checks = peerChecks(
      { known: { 'task not-proven id': 'refine проверяется образцами в этой же проверке' } },
      { snapshot: () => createSnapshot({ reads: [strict] }), runtime: [strict] },
    );
    // Сверка видит пару читателей (roles-mismatch), но образцы читателя не разбираются.
    expect(run(byName(checks, 'нарушений'))).toBe(
      'Error: писатель: совместимость (compatible): нарушений 1:\n  task roles-mismatch (корень) — роль здесь «reader», писатель «reader»: никто не пишет то, что читает другая сторона',
    );
  });

  it('runtime: образец не объект (снимок другой стороны правлен руками) — отвергнут как есть, версия не подклеивается', () => {
    const document = JSON.parse(writerSnapshot(z.object({}))) as {
      contracts: { task: { examples: unknown[] } };
    };
    document.contracts.task.examples = ['x', null, {}];
    writeFileSync(join(root, 'peer.json'), JSON.stringify(document));
    const loose = reader(z.object({}));
    const outcome = run(
      byName(
        peerChecks({}, { snapshot: () => createSnapshot({ reads: [loose] }), runtime: [loose] }),
        'нарушений',
      ),
    );
    expect(outcome).toContain('task example-rejected examples[0] — ');
    expect(outcome).toContain('task example-rejected examples[1] — ');
    expect(outcome).not.toContain('examples[2]');
  });

  it('runtime: only ограничивает и разбор образцов', () => {
    const rejectAll = defineContract({
      name: 'other',
      version: '1.0.0',
      schema: z.object({ id: z.string().refine(() => false, 'всё запрещено') }),
    });
    writeFileSync(
      join(root, 'peer.json'),
      serializeSnapshot(
        createSnapshot({
          writes: [
            defineContract({ name: 'task', version: '1.0.0', schema: z.object({ id: z.string() }) }),
            defineContract({
              name: 'other',
              version: '1.0.0',
              schema: z.object({ id: z.string() }),
              examples: [{ id: 'x' }],
            }),
          ],
        }),
      ),
    );
    const base = { snapshot: () => createSnapshot({ reads: [reader(), rejectAll] }), runtime: [rejectAll] };
    const known = { 'other not-proven id': 'refine проверяется образцами в этой же проверке' };
    expect(run(byName(peerChecks({ only: [' task '], known }, base), 'нарушений'))).toBe('ok');
    // Двойники: без only и с only, где имя дано с пробелами, тот же образец отвергнут.
    expect(run(byName(peerChecks({ known }, base), 'нарушений'))).toContain(
      'other example-rejected examples[0]',
    );
    expect(run(byName(peerChecks({ only: [' task ', ' other '], known }, base), 'нарушений'))).toContain(
      'other example-rejected examples[0]',
    );
  });

  it('only передаётся в сверку', () => {
    writeFileSync(join(root, 'peer.json'), writerSnapshot(z.object({ id: z.string() })));
    expect(run(byName(peerChecks({ only: ['nope'] }), 'нарушений'))).toContain(
      'в выборке контракты, которых нет',
    );
  });
});

describe('gateChecks: изменение своей стороны', () => {
  it('прежний снимок не добыт — красная; удалённый контракт — нарушение изменения', () => {
    mkdirSync(join(root, 'old'), { recursive: true });
    const missing = gateChecks(
      options({ previous: { source: { kind: 'file', path: 'old/none.json' } } }),
    ).checks;
    expect(run(byName(missing, 'прежний снимок добыт'))).toMatch(/^PeerSnapshotUnavailableError: /);
    writeFileSync(
      join(root, 'old', 'snap.json'),
      serializeSnapshot(
        createSnapshot({
          reads: [reader(), defineContract({ name: 'gone', version: '1.0.0', schema: z.object({}) })],
        }),
      ),
    );
    const checks = gateChecks(
      options({ previous: { source: { kind: 'file', path: 'old/snap.json' } } }),
    ).checks;
    expect(run(byName(checks, 'прежний снимок добыт'))).toBe('ok');
    expect(run(byName(checks, 'нарушений'))).toContain('gone contract-missing (корень)');
    expect(readFileSync(join(root, 'old', 'snap.json'), 'utf8')).toContain('"gone"');
  });
});
