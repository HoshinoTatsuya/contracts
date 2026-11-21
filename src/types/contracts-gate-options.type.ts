import type { CompareMode } from './compare-mode.type';
import type { PeerSource } from './peer-source.type';
import type { RuntimeReader } from './runtime-reader.type';
import type { SnapshotDocument } from './snapshot-document.type';
import type { SnapshotFormatter } from './snapshot-formatter.type';

/** Настройки гейта контрактов для jest. */
export interface ContractsGateOptions {
  /** Заголовок `describe` (по умолчанию «контракты»). */
  readonly title?: string;
  /** Корень репозитория: от него считаются `committed` и запуск форматтера. */
  readonly root: string;
  /** Снимок своей стороны, собранный из кода (`createSnapshot`). */
  readonly snapshot: () => SnapshotDocument;
  /** Закоммиченный снимок (путь от корня). `CONTRACTS_UPDATE=1` его переписывает. */
  readonly committed: string;
  readonly formatter?: SnapshotFormatter;
  /** Нижняя граница числа контрактов в снимке: «совпало» на пустом снимке ничего не доказывает. */
  readonly minContracts: number;
  /** Прежний снимок своей стороны (ветка по умолчанию, развёрнутая ревизия) — проверка изменения. */
  readonly previous?: { readonly source: PeerSource; readonly known?: Readonly<Record<string, string>> };
  /** Другие стороны: откуда снимок, режим, известные расхождения с причиной. */
  readonly peers?: ReadonlyArray<{
    readonly name: string;
    readonly source: PeerSource;
    readonly mode?: CompareMode;
    readonly known?: Readonly<Record<string, string>>;
    readonly only?: readonly string[];
  }>;
  /**
   * Свои контракты на рантайме: образцы писателей другой стороны разбираются
   * НАСТОЯЩЕЙ схемой читателя — с `refine`, которых в снимке нет.
   */
  readonly runtime?: readonly RuntimeReader[];
  /** Наименьшая длина причины известного расхождения (по умолчанию 30). */
  readonly minReasonLength?: number;
}
