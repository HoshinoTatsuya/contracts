import type { ContractSnapshot } from './contract-snapshot.type';

/** Снимок контрактов одной стороны — то, что коммитится в её репозиторий. */
export interface SnapshotDocument {
  readonly format: string;
  readonly contracts: Readonly<Record<string, ContractSnapshot>>;
}
