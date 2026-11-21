import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { SnapshotFormatError } from '../errors/snapshot-format.error';
import { formatGeneration } from '../format/format-generation';
import { setOwn } from '../shape/set-own';
import type { ContractSnapshot } from '../types/contract-snapshot.type';
import type { SnapshotDocument } from '../types/snapshot-document.type';
import { parseVersion } from '../version/parse-version';
import { assertShape } from './assert-shape';
import { assertWireValue } from './assert-wire-value';

/**
 * Текст снимка → документ, с проверкой формата целиком: поле `format`, роли,
 * версии, формы, значения на проводе. Форматирование текста (отступы, порядок
 * ключей, переносы, которые внёс форматтер репозитория) на результат не влияет.
 */
export function parseSnapshot(text: string, source: string): SnapshotDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new SnapshotFormatError(
      source,
      `не JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const document = raw as { format?: unknown; contracts?: unknown } | null;
  const generation = formatGeneration(
    (document as { format?: unknown } | null)?.format,
    CONTRACT_FORMAT.SNAPSHOT,
  );
  if (
    typeof document !== 'object' ||
    document === null ||
    generation !== formatGeneration(CONTRACT_FORMAT.SNAPSHOT, CONTRACT_FORMAT.SNAPSHOT)
  ) {
    const format = (document as { format?: unknown } | null)?.format;
    throw new SnapshotFormatError(
      source,
      typeof document !== 'object' || document === null || Array.isArray(document)
        ? `документ — не объект, а ${Array.isArray(document) ? 'массив' : document === null ? 'null' : typeof document}`
        : generation === 1
          ? 'снимок формата /1 (библиотека до 0.2.0): он не отличал z.unknown() от потерянной семантики (coerce, transform) и не нёс политику записи — пересоберите снимок этой стороны библиотекой 0.2.0 или новее'
          : `поле format ${JSON.stringify(format)}, ожидалось ${JSON.stringify(CONTRACT_FORMAT.SNAPSHOT)}`,
    );
  }
  if (
    typeof document.contracts !== 'object' ||
    document.contracts === null ||
    Array.isArray(document.contracts)
  ) {
    throw new SnapshotFormatError(source, 'нет словаря contracts');
  }
  const contracts: Record<string, ContractSnapshot> = {};
  for (const [name, value] of Object.entries(document.contracts as Record<string, unknown>)) {
    const entry = value as Partial<Record<keyof ContractSnapshot, unknown>> | null;
    const fail = (detail: string): never => {
      throw new SnapshotFormatError(source, `контракт ${name}: ${detail}`);
    };
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail('запись не объект');
    }
    const known = [
      'role',
      'version',
      'versionField',
      'legacyVersion',
      'extraFields',
      'shape',
      'wire',
      'examples',
    ];
    const extra = Object.keys(entry).filter((key) => !known.includes(key));
    if (extra.length > 0) {
      fail(`незнакомые ключи записи: ${extra.join(', ')}`);
    }
    if (entry.role !== 'writer' && entry.role !== 'reader' && entry.role !== 'both') {
      fail(`неизвестная роль ${JSON.stringify(entry.role)}`);
    }
    if (parseVersion(entry.version) === null) {
      fail(`версия не разобрана: ${JSON.stringify(entry.version)}`);
    }
    if (entry.versionField !== null && typeof entry.versionField !== 'string') {
      fail('versionField — не строка и не null');
    }
    if (entry.legacyVersion !== null && parseVersion(entry.legacyVersion) === null) {
      fail(`legacyVersion — не версия и не null: ${JSON.stringify(entry.legacyVersion)}`);
    }
    if (
      entry.extraFields !== 'refused' &&
      entry.extraFields !== 'kept' &&
      entry.extraFields !== 'unchecked'
    ) {
      fail(`неизвестная политика записи extraFields ${JSON.stringify(entry.extraFields)}`);
    }
    assertShape(entry.shape, `${source}: контракт ${name}`, '');
    if (typeof entry.wire !== 'object' || entry.wire === null || Array.isArray(entry.wire)) {
      fail('wire — не словарь');
    }
    for (const [path, wire] of Object.entries(entry.wire as Record<string, unknown>)) {
      assertWireValue(wire, (detail) => fail(`wire ${path}: ${detail}`));
    }
    if (!Array.isArray(entry.examples)) {
      fail('examples — не массив');
    }
    setOwn(contracts, name, entry as unknown as ContractSnapshot);
  }
  return { format: CONTRACT_FORMAT.SNAPSHOT, contracts };
}
