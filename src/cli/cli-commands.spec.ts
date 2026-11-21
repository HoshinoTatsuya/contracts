import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import { runCli } from './run-cli';

/**
 * Каждая команда CLI на каждом своём исходе: код выхода и строка, по которой
 * джоба CI объясняет его человеку. Неверные аргументы — код 2, а не «зелёный».
 */
const root = mkdtempSync(join(tmpdir(), 'contracts-cli-commands-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const contract = (schema: z.ZodType, name = 'task') => defineContract({ name, version: '1.0.0', schema });
const write = (file: string, text: string): string => {
  writeFileSync(join(root, file), text);
  return file;
};
const cli = (...argv: string[]): { readonly code: number; readonly out: string; readonly err: string } => {
  let out = '';
  let err = '';
  const code = runCli(argv, {
    cwd: root,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
};

const writer = serializeSnapshot(createSnapshot({ writes: [contract(z.object({ id: z.string() }))] }));
const cjsModule = (document: string): string => `module.exports = { snapshot: () => (${document}) };\n`;

beforeAll(() => {
  write('w.json', writer);
  write('r-ok.json', serializeSnapshot(createSnapshot({ reads: [contract(z.object({ id: z.string() }))] })));
  write('r-bad.json', serializeSnapshot(createSnapshot({ reads: [contract(z.object({ id: z.number() }))] })));
  write('empty.json', serializeSnapshot(createSnapshot({})));
  write('mod.cjs', cjsModule(writer));
  write('mod-default.cjs', `module.exports = { default: ${writer} };\n`);
  write('mod-empty.cjs', cjsModule(serializeSnapshot(createSnapshot({}))));
  write('mod-none.cjs', 'module.exports = { other: 1 };\n');
  write('known-list.json', '[]');
  write(
    'known-stale.json',
    JSON.stringify({ 'task type-changed id': 'читатель переходит на число в следующем релизе' }),
  );
  write('known-short.json', JSON.stringify({ 'task type-changed id': 'коротко' }));
});

describe('CLI: аргументы', () => {
  it.each([
    [['snapshot', '--from', 'mod.cjs'], 'нужны --from и --out'],
    [['snapshot', '--out', 'x.json'], 'нужны --from и --out'],
    [
      ['snapshot', '--from', 'mod.cjs', '--out', 'x.json', '--formatter', 'gofmt'],
      'неизвестный форматтер gofmt',
    ],
    [['verify', '--from', 'mod.cjs'], 'нужны --from и --snapshot'],
    [['verify', '--snapshot', 'w.json'], 'нужны --from и --snapshot'],
    [['check', '--mine', 'w.json'], 'нужны --mine и --peer'],
    [['check', '--peer', 'w.json'], 'нужны --mine и --peer'],
    [['check', '--mine', 'w.json', '--peer', 'r-ok.json', '--mode', 'loose'], 'неизвестный режим loose'],
    [['check', '--mine', 'empty.json', '--peer', 'r-ok.json'], 'в своём снимке нет ни одного контракта'],
    [
      ['check', '--mine', 'w.json', '--peer', 'r-ok.json', '--known', 'nope.json'],
      'нет файла известных расхождений',
    ],
    [['check', '--mine', 'w.json', '--peer', 'r-ok.json', '--known', 'known-list.json'], 'не словарь'],
    [['evolve', '--previous', 'w.json'], 'нужны --previous и --next'],
    [['evolve', '--next', 'w.json'], 'нужны --previous и --next'],
    [
      ['record-deployed', '--ref', 'a'.repeat(40), '--snapshot-path', 's', '--out', 'o'],
      'нужны --peer, --ref',
    ],
    [['record-deployed', '--peer', 'p', '--snapshot-path', 's', '--out', 'o'], 'нужны --peer, --ref'],
    [['record-deployed', '--peer', 'p', '--ref', 'a'.repeat(40), '--out', 'o'], 'нужны --peer, --ref'],
    [
      ['record-deployed', '--peer', 'p', '--ref', 'a'.repeat(40), '--snapshot-path', 's'],
      'нужны --peer, --ref',
    ],
    [['snapshot', '--from', 'mod-none.cjs', '--out', 'x.json'], 'не экспортирует snapshot или default'],
  ] as const)('%j → код 2: %s', (argv, message) => {
    const outcome = cli(...argv);
    expect([outcome.code, outcome.err]).toEqual([2, expect.stringContaining(message)]);
    expect(outcome.err.startsWith('НЕ ПРОВЕРЕНО: ')).toBe(true);
  });

  it('неизвестная команда — использование и код 2', () => {
    const outcome = cli('publish');
    expect([outcome.code, outcome.err]).toEqual([2, expect.stringContaining('использование: contracts')]);
  });
});

describe('CLI: snapshot и verify', () => {
  it('snapshot пишет снимок из модуля; verify — актуален', () => {
    expect(cli('snapshot', '--from', 'mod.cjs', '--out', 'out.json')).toMatchObject({
      code: 0,
      out: 'снимок записан: out.json (контрактов 1)\n',
    });
    expect(readFileSync(join(root, 'out.json'), 'utf8')).toBe(writer);
    expect(cli('verify', '--from', 'mod-default.cjs', '--snapshot', 'out.json')).toMatchObject({
      code: 0,
      out: 'снимок out.json актуален (контрактов 1)\n',
    });
  });

  it('verify: нет файла — 1; снимок устарел — 1 с именем контракта; пустой — 1', () => {
    expect(cli('verify', '--from', 'mod.cjs', '--snapshot', 'missing.json')).toMatchObject({
      code: 1,
      out: '✗ нет закоммиченного снимка missing.json\n',
    });
    expect(cli('verify', '--from', 'mod.cjs', '--snapshot', 'r-ok.json')).toMatchObject({
      code: 1,
      out: '✗ снимок r-ok.json устарел: task — пересобрать `contracts snapshot`\n',
    });
    expect(cli('verify', '--from', 'mod-empty.cjs', '--snapshot', 'empty.json')).toMatchObject({
      code: 1,
      out: 'снимок empty.json актуален (контрактов 0)\n',
    });
    expect(existsSync(join(root, 'missing.json'))).toBe(false);
  });
});

describe('CLI: check, evolve, record-deployed', () => {
  it('совместимо — 0 и заголовок', () => {
    expect(cli('check', '--mine', 'w.json', '--peer', 'r-ok.json')).toMatchObject({
      code: 0,
      out: 'сверка с r-ok.json (compatible): совместимо (замечаний 0)\n',
    });
  });

  it('--json — вердикт и списки известных расхождений', () => {
    const outcome = cli(
      'check',
      '--mine',
      'w.json',
      '--peer',
      'r-bad.json',
      '--json',
      '--known',
      'known-short.json',
    );
    expect(outcome.code).toBe(1);
    expect(JSON.parse(outcome.out)).toMatchObject({
      ok: true,
      violations: [],
      unproven: [],
      stale: [],
      unexplained: ['task type-changed id'],
    });
  });

  it('устаревшее и необъяснённое известное расхождение — 1 и строка о каждом', () => {
    const stale = cli('check', '--mine', 'w.json', '--peer', 'r-ok.json', '--known', 'known-stale.json');
    expect([stale.code, stale.out]).toEqual([
      1,
      expect.stringContaining('✗ известное расхождение устарело: task type-changed id'),
    ]);
    const short = cli('check', '--mine', 'w.json', '--peer', 'r-bad.json', '--known', 'known-short.json');
    expect([short.code, short.out]).toEqual([
      1,
      expect.stringContaining('✗ известное расхождение без причины: task type-changed id'),
    ]);
  });

  it('--only с пробелами вокруг имени выбирает контракт', () => {
    expect(cli('check', '--mine', 'w.json', '--peer', 'r-bad.json', '--only', ' task ').code).toBe(1);
  });

  it('evolve: заголовок и код; --json', () => {
    expect(cli('evolve', '--previous', 'w.json', '--next', 'w.json')).toMatchObject({
      code: 0,
      out: 'изменение против w.json: совместимо (замечаний 0)\n',
    });
    expect(JSON.parse(cli('evolve', '--previous', 'w.json', '--next', 'w.json', '--json').out)).toMatchObject(
      { ok: true },
    );
  });

  it('record-deployed пишет запись', () => {
    const ref = 'b'.repeat(40);
    expect(
      cli(
        'record-deployed',
        '--peer',
        'reader',
        '--ref',
        ref,
        '--snapshot-path',
        's.json',
        '--out',
        'd/rec.json',
      ),
    ).toMatchObject({
      code: 0,
      out: `записано: reader развёрнут на ${ref}\n`,
    });
    expect(JSON.parse(readFileSync(join(root, 'd', 'rec.json'), 'utf8'))).toMatchObject({
      peer: 'reader',
      ref,
    });
  });
});

describe('CLI: края аргументов и отчёта', () => {
  beforeAll(() => {
    write('known-null.json', 'null');
    write('known-string.json', '"x"');
    const two = (shape: z.ZodRawShape) =>
      serializeSnapshot(
        createSnapshot({ writes: [contract(z.object(shape), 'zeta'), contract(z.object(shape), 'alpha')] }),
      );
    write('mod-two.cjs', cjsModule(two({})));
    write('committed-two.json', two({ id: z.string() }));
  });

  it.each(['known-null.json', 'known-string.json'])(
    'известные расхождения %s — не словарь, код 2',
    (file) => {
      const { code, err } = cli('check', '--mine', 'r-ok.json', '--peer', 'w.json', '--known', file);
      expect(code).toBe(2);
      expect(err).toContain('известные расхождения — не словарь «адрес → причина»');
    },
  );

  it.each(['biome', 'prettier'])(
    'форматтер %s — допустимое имя: отказ уже про поиск форматтера',
    (formatter) => {
      const { code, err } = cli('snapshot', '--from', 'mod.cjs', '--out', 'f.json', '--formatter', formatter);
      expect(code).toBe(2);
      expect(err).toContain(`форматтер ${formatter} не найден в node_modules/.bin`);
    },
  );

  it('verify: порядок имён — по алфавиту, даже если закоммиченный файл записан не по порядку', () => {
    const generated = JSON.parse(
      serializeSnapshot(createSnapshot({ writes: [contract(z.object({}), 'alpha')] })),
    ) as {
      format: string;
      contracts: Record<string, unknown>;
    };
    const zeta = JSON.parse(
      serializeSnapshot(createSnapshot({ writes: [contract(z.object({}), 'zeta')] })),
    ) as {
      contracts: Record<string, unknown>;
    };
    write('mod-alpha.cjs', cjsModule(JSON.stringify(generated)));
    // Только zeta в закоммиченном, только alpha в собранном: объединение без сортировки дало бы «zeta, alpha».
    write('committed-zeta.json', JSON.stringify({ format: generated.format, contracts: zeta.contracts }));
    const { code, out } = cli('verify', '--from', 'mod-alpha.cjs', '--snapshot', 'committed-zeta.json');
    expect(code).toBe(1);
    expect(out).toBe(
      '✗ снимок committed-zeta.json устарел: alpha, zeta — пересобрать `contracts snapshot`\n',
    );
  });

  it('verify: устаревшие контракты по имени, по порядку', () => {
    const { code, out } = cli('verify', '--from', 'mod-two.cjs', '--snapshot', 'committed-two.json');
    expect(code).toBe(1);
    expect(out).toBe('✗ снимок committed-two.json устарел: alpha, zeta — пересобрать `contracts snapshot`\n');
  });

  it('check --mode aligned и evolve --known — допустимые флаги', () => {
    expect(cli('check', '--mine', 'r-ok.json', '--peer', 'w.json', '--mode', 'aligned').code).toBe(0);
    const evolve = cli('evolve', '--previous', 'w.json', '--next', 'w.json', '--known', 'known-stale.json');
    expect(evolve.code).toBe(1);
    expect(evolve.err).not.toContain('неизвестный флаг');
  });
});
