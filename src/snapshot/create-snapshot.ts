import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { ContractDefinitionError } from '../errors/contract-definition.error';
import { describeThrown } from '../runtime/describe-thrown';
import { setOwn } from '../shape/set-own';
import type { ContractRole } from '../types/contract-role.type';
import type { ContractSnapshot } from '../types/contract-snapshot.type';
import type { SnapshotDocument } from '../types/snapshot-document.type';
import type { SnapshotSource } from '../types/snapshot-source.type';
import { parseSnapshot } from './parse-snapshot';
import { serializeSnapshot } from './serialize-snapshot';

/**
 * Снимок стороны: какие контракты она пишет, какие читает, какие и то и
 * другое. Роль — свойство СТОРОНЫ, а не контракта: копии одного контракта у
 * двух сторон одинаковы, а роли у них противоположны.
 */
export function createSnapshot(roles: {
  readonly writes?: readonly SnapshotSource[];
  readonly reads?: readonly SnapshotSource[];
  readonly both?: readonly SnapshotSource[];
}): SnapshotDocument {
  const contracts: Record<string, ContractSnapshot> = {};
  const add = (sources: readonly SnapshotSource[] | undefined, role: ContractRole): void => {
    for (const source of sources ?? []) {
      if (typeof source.name !== 'string' || source.name.trim() === '') {
        throw new ContractDefinitionError(
          'снимок',
          '',
          `имя контракта пустое или не строка: ${JSON.stringify(source.name)}`,
        );
      }
      if (Object.hasOwn(contracts, source.name)) {
        throw new ContractDefinitionError(source.name, '', 'контракт указан в снимке дважды');
      }
      let entry: ContractSnapshot;
      try {
        entry = source.snapshot(role);
        // Запись проверяется тем же разбором, что снимок другой стороны: ошибка — здесь и с именем, а не при записи файла.
        parseSnapshot(
          serializeSnapshot({ format: CONTRACT_FORMAT.SNAPSHOT, contracts: { [source.name]: entry } }),
          source.name,
        );
      } catch (error) {
        if (error instanceof ContractDefinitionError) {
          throw error;
        }
        throw new ContractDefinitionError(
          source.name,
          '',
          `запись снимка (роль ${role}) не собрана: ${describeThrown(error, 'message')}`,
        );
      }
      setOwn(contracts, source.name, entry);
    }
  };
  add(roles.writes, 'writer');
  add(roles.reads, 'reader');
  add(roles.both, 'both');
  return { format: CONTRACT_FORMAT.SNAPSHOT, contracts };
}
