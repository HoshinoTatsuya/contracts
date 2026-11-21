/**
 * Компиляторы, на которых гоняются таблицы разбора: `typescript` пакета
 * (5.9) и псевдонимы devDependencies — 6.0, 7.0 (latest) и 7.1 beta. Итог
 * обязан совпасть у всех: одна таблица ожиданий на все версии.
 */
export const COMPILERS: ReadonlyArray<readonly [compiler: string, version: string]> = [
  ['typescript', '5.9'],
  ['typescript-6', '6.0'],
  ['typescript-7', '7.0'],
  ['typescript-7-1', '7.1'],
];
