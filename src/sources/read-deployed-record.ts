import { existsSync, readFileSync } from 'node:fs';

import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import { formatGeneration } from '../format/format-generation';
import type { DeployedRecord } from '../types/deployed-record.type';

/** Запись о развёрнутой ревизии; нет файла, чужой формат, ревизия не хэш — отказ. */
export function readDeployedRecord(file: string): DeployedRecord {
  if (!existsSync(file)) {
    throw new PeerSnapshotUnavailableError(`deployed:${file}`, 'нет записи о развёрнутой ревизии');
  }
  let record: Partial<DeployedRecord>;
  try {
    record = JSON.parse(readFileSync(file, 'utf8')) as Partial<DeployedRecord>;
  } catch (error) {
    throw new PeerSnapshotUnavailableError(
      `deployed:${file}`,
      `не JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    formatGeneration(record.format, CONTRACT_FORMAT.DEPLOYED) !==
    formatGeneration(CONTRACT_FORMAT.DEPLOYED, CONTRACT_FORMAT.DEPLOYED)
  ) {
    throw new PeerSnapshotUnavailableError(
      `deployed:${file}`,
      `поле format ${JSON.stringify(record.format)}, ожидалось ${CONTRACT_FORMAT.DEPLOYED}`,
    );
  }
  // Хэш в верхнем регистре — тот же коммит: git сравнивает его без учёта регистра.
  if (typeof record.ref === 'string') {
    record = { ...record, ref: record.ref.toLowerCase() };
  }
  if (typeof record.ref !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(record.ref)) {
    throw new PeerSnapshotUnavailableError(
      `deployed:${file}`,
      `ревизия ${JSON.stringify(record.ref)} — не полный хэш коммита`,
    );
  }
  if (
    typeof record.snapshotPath !== 'string' ||
    record.snapshotPath === '' ||
    typeof record.peer !== 'string'
  ) {
    throw new PeerSnapshotUnavailableError(`deployed:${file}`, 'нет snapshotPath или peer');
  }
  return record as DeployedRecord;
}
