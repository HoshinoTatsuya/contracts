import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { ContractDefinitionError } from '../errors/contract-definition.error';
import { stableJson } from '../shape/stable-json';
import type { DeployedRecord } from '../types/deployed-record.type';

/**
 * Записать, какая ревизия другой стороны развёрнута (шаг конвейера выкатки).
 * Ревизия — полный хэш: имя ветки сдвигается, и запись перестала бы означать
 * «развёрнуто» в тот же миг, как в ветку что-то слили.
 */
export function recordDeployed(
  file: string,
  record: { readonly peer: string; readonly ref: string; readonly snapshotPath: string },
): DeployedRecord {
  const ref = typeof record.ref === 'string' ? record.ref.toLowerCase() : record.ref;
  if (typeof ref !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ref)) {
    throw new ContractDefinitionError(
      record.peer,
      'ref',
      `ревизия ${JSON.stringify(record.ref)} — не полный хэш коммита`,
    );
  }
  if (record.snapshotPath === '' || record.peer === '') {
    throw new ContractDefinitionError(record.peer, '', 'пустой peer или snapshotPath');
  }
  const document: DeployedRecord = { format: CONTRACT_FORMAT.DEPLOYED, ...record, ref };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${stableJson(document, 2)}\n`);
  return document;
}
