import type { EngineProgram } from '../types/engine-program.type';
import type { TypeScriptEngine } from '../types/type-script-engine.type';
import type { TypeScriptProgram } from '../types/type-script-program.type';

/**
 * Что стоит за программой, которую вернул `createProgram`: движок и его
 * программа. Снаружи у программы только `compiler` и `dispose` — внутренности
 * компилятора в декларации пакета не попадают.
 */
export const PROGRAM_ENTRIES = new WeakMap<
  TypeScriptProgram,
  { readonly engine: TypeScriptEngine; readonly program: EngineProgram; disposed: boolean }
>();
