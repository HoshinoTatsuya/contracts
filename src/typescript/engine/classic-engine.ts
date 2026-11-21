import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type ts from 'typescript';

import type { EngineSyntax } from '../../types/engine-syntax.type';
import type { TypeScriptCompiler } from '../../types/type-script-compiler.type';
import type { TypeScriptEngine } from '../../types/type-script-engine.type';
import { classicProgram } from './classic-program';

/** TypeScript 5.9/6.x: JS API в этом процессе; проверки вида узла и словари — сам модуль. */
export function classicEngine(api: typeof ts, compiler: TypeScriptCompiler): TypeScriptEngine {
  return {
    compiler,
    syntax: api as unknown as EngineSyntax,
    open: (files, tsconfig) => classicProgram(api, files, tsconfig),
    parse: () => ({
      sourceFile: (file) =>
        api.createSourceFile(
          resolve(file),
          readFileSync(resolve(file), 'utf8'),
          api.ScriptTarget.Latest,
          true,
        ),
      dispose: () => undefined,
    }),
  };
}
