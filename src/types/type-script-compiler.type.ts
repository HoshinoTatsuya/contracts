/** Компилятор, которым снята форма: версия установленного пакета и вид его программного API. */
export interface TypeScriptCompiler {
  /** Версия пакета (поле `version` его входа). */
  readonly version: string;
  /**
   * `classic` — JS API TypeScript 5.9/6.x в этом процессе; `native` —
   * компилятор на Go (TypeScript 7) отдельным процессом через его
   * синхронный API.
   */
  readonly api: 'classic' | 'native';
  /** Каталог пакета, из которого загружен компилятор. */
  readonly directory: string;
}
