import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Скрипт в ОТДЕЛЬНОМ процессе node против ИСХОДНИКА пакета (TypeScript
 * транспилируется на лету), а не собранного dist: правка исходника иначе не
 * проверялась бы ничем до сборки. Нужен там, где исход — судьба процесса:
 * необработанное отклонение Promise роняет процесс с кодом 1, хотя вызывающий
 * поймал ошибку, — внутри процесса jest этого не видно.
 *
 * В скрипте доступны `lib` (корень пакета) и `z` (zod пакета). Потолок —
 * 30 с: зависание падает тестом, а не держит прогон.
 */
export function runSource(script: string): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const source = join(__dirname, '..');
  const preamble = `
const ts = require(${JSON.stringify(require.resolve('typescript'))});
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText;
  module._compile(output, file);
};
const lib = require(${JSON.stringify(join(source, 'index.ts'))});
const { z } = require(${JSON.stringify(require.resolve('zod'))});
`;
  const run = spawnSync(process.execPath, ['-e', `${preamble}\n${script}`], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}
