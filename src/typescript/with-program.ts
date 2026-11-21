import type { EngineProgram } from '../types/engine-program.type';
import type { TypeScriptEngine } from '../types/type-script-engine.type';
import type { TypeScriptProgram } from '../types/type-script-program.type';
import { createProgram } from './create-program';
import { programEntry } from './program-entry';

/**
 * Выполнить разбор на переданной программе или на своей — собранной по
 * одному файлу и освобождённой после (у TS 7 это процесс компилятора).
 */
export function withProgram<T>(
  input: {
    readonly file: string;
    readonly tsconfig?: string;
    readonly compiler?: string;
    readonly program?: TypeScriptProgram;
  },
  run: (engine: TypeScriptEngine, program: EngineProgram) => T,
): T {
  const program =
    input.program ??
    createProgram([input.file], {
      ...(input.tsconfig === undefined ? {} : { tsconfig: input.tsconfig }),
      ...(input.compiler === undefined ? {} : { compiler: input.compiler }),
    });
  try {
    const entry = programEntry(program);
    return run(entry.engine, entry.program);
  } finally {
    if (input.program === undefined) {
      program.dispose();
    }
  }
}
