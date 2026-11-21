import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { defineContract } from '../runtime/define-contract';
import { tsSourcePreamble } from '../testing/ts-source-preamble';
import { writeFakeCmdExe } from '../testing/write-fake-cmd-exe';
import { createSnapshot } from './create-snapshot';
import { serializeSnapshot } from './serialize-snapshot';
import { writeSnapshot } from './write-snapshot';

/**
 * Форматтер по имени — настоящим процессом: поддельные `biome`/`prettier` в
 * `node_modules/.bin` записывают свой каталог запуска и аргументы, падают с
 * кодом или сигналом. Проверяются аргументы каждого форматтера, поиск
 * `node_modules/.bin` вверх по дереву, точный текст каждого отказа. Ветка
 * Windows (`.cmd` через cmd.exe) — подменой `process.platform` и поддельным
 * cmd.exe в `comspec`: он разбирает строку моделью cmd.exe + MSVCRT и
 * запускает обёртку (тот же скрипт POSIX) с разобранным argv.
 */
const posix = process.platform === 'win32' ? describe.skip : describe;
// Реальный путь: форматтер видит каталог запуска без символических ссылок (/var → /private/var на macOS).
const root = realpathSync(mkdtempSync(join(tmpdir(), 'contracts-write-snapshot-')));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
const document = createSnapshot({
  reads: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({ id: z.string() }) })],
});
const outcome = (run: () => void): string => {
  try {
    run();
    return 'ok';
  } catch (error) {
    return error instanceof Error
      ? `${error.name}: ${error.message.split(root).join('<root>')}`
      : String(error);
  }
};
const fake = (project: string, name: string, body: string): void => {
  const bin = join(root, project, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
// Каталог запуска и аргументы — построчно в файл рядом с node_modules.
const RECORD = 'printf "%s\\n" "$PWD" "$@" > "$(dirname "$0")/../../$(basename "$0").args"';

posix('writeSnapshot: форматтер по имени', () => {
  it('biome — `format --write <путь>`, prettier — `--write <путь>`; запуск из каталога с node_modules, найденного вверх по дереву', () => {
    fake('ok', 'biome', RECORD);
    fake('ok', 'prettier', RECORD);
    mkdirSync(join(root, 'ok', 'packages', 'app'), { recursive: true });
    const cwd = join(root, 'ok', 'packages', 'app');
    expect(outcome(() => writeSnapshot('s.json', document, { formatter: 'biome', cwd }))).toBe('ok');
    expect(outcome(() => writeSnapshot('s.json', document, { formatter: 'prettier', cwd }))).toBe('ok');
    const file = join(cwd, 's.json');
    const project = join(root, 'ok');
    expect(readFileSync(join(project, 'biome.args'), 'utf8').split('\n')).toEqual([
      project,
      'format',
      '--write',
      file,
      '',
    ]);
    expect(readFileSync(join(project, 'prettier.args'), 'utf8').split('\n')).toEqual([
      project,
      '--write',
      file,
      '',
    ]);
    expect(readFileSync(file, 'utf8')).toBe(serializeSnapshot(document));
  });

  it('без форматтера — только запись, даже если рядом есть node_modules/.bin', () => {
    fake('plain', 'biome', 'exit 9');
    expect(outcome(() => writeSnapshot('s.json', document, { cwd: join(root, 'plain') }))).toBe('ok');
    expect(
      outcome(() => writeSnapshot('t.json', document, { cwd: join(root, 'plain'), formatter: 'none' })),
    ).toBe('ok');
  });

  it('форматтер упал с кодом — отказ с кодом и его выводом', () => {
    fake('fail', 'prettier', 'echo "  сломано  " >&2; exit 3');
    expect(
      outcome(() => writeSnapshot('s.json', document, { formatter: 'prettier', cwd: join(root, 'fail') })),
    ).toBe('ContractDefinitionError: снимок (s.json): форматтер prettier завершился с кодом 3: сломано');
    fake('quiet', 'prettier', 'echo "в stdout"; exit 4');
    expect(
      outcome(() => writeSnapshot('s.json', document, { formatter: 'prettier', cwd: join(root, 'quiet') })),
    ).toBe('ContractDefinitionError: снимок (s.json): форматтер prettier завершился с кодом 4: в stdout');
    fake('silent', 'prettier', 'exit 5');
    expect(
      outcome(() => writeSnapshot('s.json', document, { formatter: 'prettier', cwd: join(root, 'silent') })),
    ).toBe('ContractDefinitionError: снимок (s.json): форматтер prettier завершился с кодом 5: ');
  });

  it('форматтер убит сигналом — отказ с именем сигнала', () => {
    // Скрипт завершает сам себя; библиотека сигналов не шлёт.
    fake('signal', 'prettier', 'kill -TERM $$');
    expect(
      outcome(() => writeSnapshot('s.json', document, { formatter: 'prettier', cwd: join(root, 'signal') })),
    ).toBe('ContractDefinitionError: снимок (s.json): форматтер prettier завершился сигналом SIGTERM: ');
  });

  it('отказы названы снимком и путём: каталог, нет форматтера, не запустился, содержание изменено', () => {
    mkdirSync(join(root, 'dir', 'snap.json'), { recursive: true });
    expect(outcome(() => writeSnapshot('snap.json', document, { cwd: join(root, 'dir') }))).toBe(
      'ContractDefinitionError: снимок (snap.json): путь снимка — каталог; укажите файл (contracts.snapshot.json)',
    );
    expect(
      outcome(() => writeSnapshot('s.json', document, { cwd: join(root, 'dir'), formatter: 'biome' })),
    ).toMatch(
      /^ContractDefinitionError: снимок \(s\.json\): форматтер biome не найден в node_modules\/\.bin$/,
    );
    const bin = join(root, 'noexec', 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'biome'), 'not executable');
    chmodSync(join(bin, 'biome'), 0o644);
    expect(
      outcome(() => writeSnapshot('s.json', document, { cwd: join(root, 'noexec'), formatter: 'biome' })),
    ).toMatch(/^ContractDefinitionError: снимок \(s\.json\): форматтер biome не запустился: /);
    expect(
      outcome(() =>
        writeSnapshot('s.json', document, {
          cwd: join(root, 'dir'),
          formatter: (file) => writeFileSync(file, readFileSync(file, 'utf8').replace('"m"', '"n"')),
        }),
      ),
    ).toBe('ContractDefinitionError: снимок (s.json): форматтер изменил содержание снимка');
    expect(
      outcome(() =>
        writeSnapshot('gone.json', document, {
          cwd: join(root, 'dir'),
          formatter: (file) => rmSync(file),
        }),
      ),
    ).toMatch(
      /^ContractDefinitionError: снимок \(gone\.json\): после форматтера снимок не прочитать: Error: ENOENT: no such file or directory/,
    );
  });
});

posix('writeSnapshot: форматтер на Windows (.cmd через cmd.exe)', () => {
  const fakeCmd = writeFakeCmdExe(root);
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const asWindows = (run: () => void): void => {
    const comspec = process.env.comspec;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.comspec = fakeCmd.path;
    try {
      run();
    } finally {
      if (platform !== undefined) {
        Object.defineProperty(process, 'platform', platform);
      }
      if (comspec === undefined) {
        delete process.env.comspec;
      } else {
        process.env.comspec = comspec;
      }
    }
  };

  it('путь снимка и каталог проекта с %, ^, !, &, пробелами и кавычкой доходят до обёртки буквально (до 0.3.1 — отказ)', () => {
    const project = 'win a&b %USERNAME% ^!(1)';
    fake(project, 'biome.cmd', RECORD);
    const file = 'snap %PATH% ^x "q".json';
    expect(
      outcome(() =>
        asWindows(() => writeSnapshot(file, document, { formatter: 'biome', cwd: join(root, project) })),
      ),
    ).toBe('ok');
    expect(fakeCmd.calls().at(-1)).toEqual({
      program: join(root, project, 'node_modules', '.bin', 'biome.cmd'),
      argv: ['format', '--write', join(root, project, file)],
    });
    expect(readFileSync(join(root, project, 'biome.cmd.args'), 'utf8').split('\n')).toEqual([
      join(root, project),
      'format',
      '--write',
      join(root, project, file),
      '',
    ]);
  });

  it('перевод строки в пути — отказ снимка до запуска форматтера', () => {
    fake('win-nl', 'prettier.cmd', RECORD);
    const before = fakeCmd.calls().length;
    expect(
      outcome(() =>
        asWindows(() =>
          writeSnapshot('a\nb.json', document, { formatter: 'prettier', cwd: join(root, 'win-nl') }),
        ),
      ),
    ).toBe(
      `ContractDefinitionError: снимок (<root>/win-nl/a\nb.json): путь с переводом строки не передать в cmd.exe — переименуйте`,
    );
    expect(fakeCmd.calls()).toHaveLength(before);
  });

  /**
   * DEP0190 Node печатает ОДИН раз на процесс, а процесс jest общий для многих
   * спек, — поэтому запуск в отдельном процессе node, где `process.platform`
   * подменён целиком (и для самого Node): при `shell: true` Node собрал бы
   * строку сам и отдал бы её тому же поддельному cmd.exe.
   */
  const runAsWindowsProcess = (
    cwd: string,
    file: string,
  ): { readonly status: number | null; readonly warnings: string[]; readonly error: string | null } => {
    const script = `${tsSourcePreamble()}
const { writeSnapshot } = require(${JSON.stringify(join(__dirname, 'write-snapshot.ts'))});
const { parseSnapshot } = require(${JSON.stringify(join(__dirname, 'parse-snapshot.ts'))});
const document = parseSnapshot(${JSON.stringify(serializeSnapshot(document))}, 'документ');
const warnings = [];
process.on('warning', (warning) => warnings.push(warning.code || warning.name));
Object.defineProperty(process, 'platform', { value: 'win32' });
process.env.comspec = ${JSON.stringify(fakeCmd.path)};
let error = null;
try {
  writeSnapshot(${JSON.stringify(file)}, document, { formatter: 'biome', cwd: ${JSON.stringify(cwd)} });
} catch (caught) {
  error = String(caught.message);
}
setImmediate(() => process.stdout.write(JSON.stringify({ warnings, error })));
`;
    const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30_000 });
    const parsed = JSON.parse(run.stdout || '{"warnings":[],"error":"нет вывода"}') as {
      warnings: string[];
      error: string | null;
    };
    return { status: run.status, ...parsed };
  };

  it('отдельный процесс: ни одного предупреждения Node, в т. ч. DEP0190, — аргументы доходят', () => {
    fake('win-proc', 'biome.cmd', RECORD);
    const cwd = join(root, 'win-proc');
    expect(runAsWindowsProcess(cwd, 'with space.json')).toEqual({ status: 0, warnings: [], error: null });
    expect(fakeCmd.calls().at(-1)?.argv).toEqual(['format', '--write', join(cwd, 'with space.json')]);
  });

  it('отдельный процесс: путь с %, ^, & и ! — без предупреждений, путь буквально', () => {
    fake('win-proc2 %USERNAME% &^!', 'biome.cmd', RECORD);
    const cwd = join(root, 'win-proc2 %USERNAME% &^!');
    expect(runAsWindowsProcess(cwd, '%PATH% ^x.json')).toEqual({ status: 0, warnings: [], error: null });
    expect(fakeCmd.calls().at(-1)?.argv).toEqual(['format', '--write', join(cwd, '%PATH% ^x.json')]);
  });
});
