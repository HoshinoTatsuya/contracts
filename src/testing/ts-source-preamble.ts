/**
 * Начало скрипта для ОТДЕЛЬНОГО процесса node, который подключает исходники
 * пакета (`.ts`) напрямую: TypeScript транспилируется на лету компилятором
 * из devDependencies. Нужен там, где исход виден только целому процессу —
 * например, предупреждение Node, которое печатается один раз на процесс.
 */
export const tsSourcePreamble = (): string => `
const __ts = require(${JSON.stringify(require.resolve('typescript'))});
const __fs = require('node:fs');
require.extensions['.ts'] = (module, file) => {
  const output = __ts.transpileModule(__fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: __ts.ModuleKind.CommonJS, target: __ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText;
  module._compile(output, file);
};
`;
