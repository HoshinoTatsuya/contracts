import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { tsSourcePreamble } from './ts-source-preamble';

/**
 * Поддельный `cmd.exe` для проверки ветки Windows на POSIX: получает
 * `/d /s /c "<строка>"`, разбирает её моделью `emulateCmdExe` (строже
 * настоящего cmd.exe) и запускает разобранную программу с разобранным argv.
 * Каждый разбор дописывается строкой JSON в журнал рядом (`calls()`): путь
 * зашит в скрипт, потому что окружение процесса jest до дочернего не доходит.
 * Строка, которую cmd.exe разрезал бы или раскрыл, — код 9009 % 256 и
 * причина в stderr.
 */
export const writeFakeCmdExe = (
  dir: string,
): {
  readonly path: string;
  calls(): { readonly program: string; readonly argv: readonly string[] }[];
} => {
  const path = join(dir, 'fake-cmd.exe');
  const journal = join(dir, 'fake-cmd.calls.jsonl');
  writeFileSync(
    path,
    `#!${process.execPath}
${tsSourcePreamble()}
const { emulateCmdExe } = require(${JSON.stringify(join(__dirname, 'emulate-cmd-exe.ts'))});
let decoded;
try {
  decoded = emulateCmdExe(process.argv.slice(2));
} catch (error) {
  process.stderr.write('поддельный cmd.exe: ' + error.message + '\\n');
  process.exit(9009 % 256);
}
require('node:fs').appendFileSync(${JSON.stringify(journal)}, JSON.stringify(decoded) + '\\n');
const run = require('node:child_process').spawnSync(decoded.program, decoded.argv, { stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
`,
  );
  chmodSync(path, 0o755);
  return {
    path,
    calls: () =>
      existsSync(journal)
        ? readFileSync(journal, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line) as { program: string; argv: string[] })
        : [],
  };
};
