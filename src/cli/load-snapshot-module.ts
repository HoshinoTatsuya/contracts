import { resolve } from 'node:path';

import { SnapshotFormatError } from '../errors/snapshot-format.error';
import { parseSnapshot } from '../snapshot/parse-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import type { SnapshotDocument } from '../types/snapshot-document.type';

/**
 * Снимок своей стороны из модуля проекта: экспорт `snapshot` или `default` —
 * документ `createSnapshot` или функция без аргументов, его возвращающая.
 * Модуль грузится `require` (собранный JS; `.ts` — средствами Node 24).
 * Документ проходит ту же проверку формата, что снимок другой стороны.
 */
export function loadSnapshotModule(file: string, cwd: string): SnapshotDocument {
  const path = resolve(cwd, file);
  const loaded = require(path) as { snapshot?: unknown; default?: unknown };
  const exported = loaded.snapshot ?? loaded.default;
  const value: unknown = typeof exported === 'function' ? (exported as () => unknown)() : exported;
  if (typeof value !== 'object' || value === null) {
    throw new SnapshotFormatError(
      path,
      'модуль не экспортирует snapshot или default — снимок или функцию, его возвращающую',
    );
  }
  return parseSnapshot(serializeSnapshot(value as SnapshotDocument), path);
}
