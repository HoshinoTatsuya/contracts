/**
 * Итог чтения: разобранные данные, версия писателя и поля, которых читатель
 * не знает. Пути неизвестных полей — с индексами массивов, свёрнутыми в `[]`,
 * без повторов и не больше `CONTRACT_FORMAT.MAX_UNKNOWN_PATHS`; сколько путей
 * не вошло — `omittedUnknownFields`.
 */
export interface ReadResult<T> {
  readonly data: T;
  readonly version: string;
  readonly unknownFields: readonly string[];
  readonly omittedUnknownFields: number;
}
