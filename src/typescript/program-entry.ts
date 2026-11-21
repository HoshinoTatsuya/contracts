import { TypeScriptCompilerError } from '../errors/type-script-compiler.error';
import type { EngineProgram } from '../types/engine-program.type';
import type { TypeScriptEngine } from '../types/type-script-engine.type';
import type { TypeScriptProgram } from '../types/type-script-program.type';
import { PROGRAM_ENTRIES } from './program-entries.constant';

/** Движок и программа за значением `createProgram`; закрытая или чужая программа — отказ. */
export function programEntry(program: TypeScriptProgram): {
  readonly engine: TypeScriptEngine;
  readonly program: EngineProgram;
} {
  const entry = PROGRAM_ENTRIES.get(program);
  if (entry === undefined) {
    throw new TypeScriptCompilerError(
      'program — не значение createProgram этого пакета (программа TypeScript 5.9/6.x передаётся через createProgram)',
    );
  }
  if (entry.disposed) {
    throw new TypeScriptCompilerError('программа TypeScript уже закрыта (dispose)');
  }
  return entry;
}
