import type { TypeScriptOptions } from '../types/type-script-options.type';
import type { TypeScriptProgram } from '../types/type-script-program.type';
import { loadTypeScript } from './engine/load-type-script';
import { PROGRAM_ENTRIES } from './program-entries.constant';

/**
 * Программа TypeScript для снятия формы — одна сборка на несколько
 * `shapeFromTypeScript`/`wireFromTypeScript`. Компилятор — установленный
 * `typescript` (5.9/6.x — JS API в процессе, 7.x — процесс компилятора на
 * Go), выбирается по его фактическому API. tsconfig проекта (алиасы путей,
 * `moduleResolution`, `allowJs`, `target`), но `strict` всегда — без
 * `strictNullChecks` компилятор стирает `null` и `undefined` из типов, и
 * необязательность полей пропала бы из снимка. Строка вместо опций — путь к
 * tsconfig.
 *
 * Программу освобождает `dispose()`: у TS 7 это остановка процесса.
 */
export function createProgram(
  files: readonly string[],
  options: TypeScriptOptions | string = {},
): TypeScriptProgram {
  const { tsconfig, compiler } =
    typeof options === 'string' ? { tsconfig: options, compiler: undefined } : options;
  const engine = loadTypeScript(compiler);
  const program = engine.open(files, tsconfig);
  const entry = { engine, program, disposed: false };
  const handle: TypeScriptProgram = Object.freeze({
    compiler: engine.compiler,
    dispose: (): void => {
      if (!entry.disposed) {
        entry.disposed = true;
        program.dispose();
      }
    },
  });
  PROGRAM_ENTRIES.set(handle, entry);
  return handle;
}
