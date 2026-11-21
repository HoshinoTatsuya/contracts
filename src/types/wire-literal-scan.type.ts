/** Итог поиска литералов провода: сколько файлов просмотрено и где нашлись литералы. */
export interface WireLiteralScan {
  readonly files: number;
  readonly hits: ReadonlyArray<{ readonly file: string; readonly line: number; readonly value: string }>;
}
