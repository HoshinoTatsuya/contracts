import type { ContractRole } from './contract-role.type';
import type { ContractSnapshot } from './contract-snapshot.type';

/** То, из чего собирается снимок стороны: контракт `defineContract` или снятый с TypeScript. */
export interface SnapshotSource {
  readonly name: string;
  snapshot(role: ContractRole): ContractSnapshot;
}
