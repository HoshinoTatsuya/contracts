import { stableJson } from '../shape/stable-json';
import type { SnapshotDocument } from '../types/snapshot-document.type';

/**
 * Текст снимка: ключи по алфавиту, отступ 2, перевод строки в конце.
 * Одинаковый контракт — побайтно одинаковый текст.
 */
export function serializeSnapshot(document: SnapshotDocument): string {
  return `${stableJson(document, 2)}\n`;
}
