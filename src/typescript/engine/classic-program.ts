import { dirname, resolve } from 'node:path';

import type ts from 'typescript';

import { ContractDefinitionError } from '../../errors/contract-definition.error';
import type { EngineProgram } from '../../types/engine-program.type';
import { classicChecker } from './classic-checker';

/**
 * Программа TypeScript 5.9/6.x: tsconfig проекта (алиасы путей, baseUrl), но
 * `strict` всегда — без `strictNullChecks` компилятор стирает `null` и
 * `undefined` из типов, и необязательность полей пропала бы из снимка.
 */
export function classicProgram(
  api: typeof ts,
  files: readonly string[],
  tsconfig: string | undefined,
): EngineProgram {
  let options: ts.CompilerOptions = {};
  if (tsconfig !== undefined) {
    const path = resolve(tsconfig);
    const read = api.readConfigFile(path, api.sys.readFile);
    if (read.error !== undefined) {
      throw new ContractDefinitionError(
        'tsconfig',
        path,
        api.flattenDiagnosticMessageText(read.error.messageText, '\n'),
      );
    }
    options = api.parseJsonConfigFileContent(read.config, api.sys, dirname(path), undefined, path).options;
  }
  const program = api.createProgram(
    files.map((file) => resolve(file)),
    {
      ...options,
      strict: true,
      strictNullChecks: true,
      noEmit: true,
      skipLibCheck: true,
      allowJs: options.allowJs ?? false,
      target: options.target ?? api.ScriptTarget.ES2022,
      module: options.module ?? api.ModuleKind.NodeNext,
      moduleResolution: options.moduleResolution ?? api.ModuleResolutionKind.NodeNext,
    },
  );
  return {
    sourceFile: (file) => program.getSourceFile(resolve(file)),
    checker: classicChecker(api, program),
    dispose: () => undefined,
  };
}
