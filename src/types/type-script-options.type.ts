/** Как собрать программу TypeScript. */
export interface TypeScriptOptions {
  /** tsconfig проекта: алиасы путей, `moduleResolution`, `allowJs`, `target`. */
  readonly tsconfig?: string;
  /**
   * Имя пакета компилятора вместо `typescript` — например, псевдоним
   * `typescript-7` рядом с `typescript` 5.9 на время перехода. Резолвится от
   * текущего каталога процесса; без этого поля — `typescript`, видимый
   * пакету.
   */
  readonly compiler?: string;
}
