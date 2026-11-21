import type { TypeScriptCompiler } from './type-script-compiler.type';

/**
 * Программа TypeScript, собранная `createProgram`: одна сборка на несколько
 * `shapeFromTypeScript`/`wireFromTypeScript`. Своя обёртка, а не тип пакета
 * `typescript`: у TS 7 прежнего JS API нет, и декларации пакета не должны
 * ссылаться на его типы.
 */
export interface TypeScriptProgram {
  readonly compiler: TypeScriptCompiler;
  /**
   * Освободить программу. У TS 7 это остановка процесса компилятора; у 5.9/6.x
   * — отпустить ссылки. Повторный вызов ничего не делает; вызов с закрытой
   * программой — отказ.
   */
  dispose(): void;
}
