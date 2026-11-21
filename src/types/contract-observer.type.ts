/**
 * Хуки наблюдения за чтением: куда повесить метрику, чтобы тихая потеря стала
 * видимой. Исключение хука чтение не роняет — оно уходит предупреждением
 * процесса (`process.emitWarning`), а разбор продолжается.
 */
export interface ContractObserver {
  /**
   * В payload пришли поля, которых контракт читателя не знает (`meta.extra`,
   * `items[].x`). Индексы массивов свёрнуты в `[]`, повторы убраны, путей не
   * больше `CONTRACT_FORMAT.MAX_UNKNOWN_PATHS` — пригодно для метки метрики;
   * `omitted` — сколько путей не вошло.
   */
  readonly unknownFields?: (event: {
    readonly contract: string;
    readonly version: string;
    readonly paths: readonly string[];
    readonly omitted: number;
  }) => void;
  /** Писатель на более новом миноре, чем читатель: часть полей может быть выброшена. */
  readonly newerVersion?: (event: {
    readonly contract: string;
    readonly version: string;
    readonly readerVersion: string;
  }) => void;
  /** Payload без поля версии принят как `legacyVersion` (писатель до введения версии). */
  readonly legacyPayload?: (event: { readonly contract: string; readonly assumedVersion: string }) => void;
}
