/**
 * Символ компилятора за адаптером: у TS 7 объявления символа — ссылки на
 * узлы, а не узлы, имя — поле, а не метод. Общий код трогает символ только
 * через `EngineChecker`.
 */
export interface EngineSymbol {
  readonly '#engineSymbol': never;
}
