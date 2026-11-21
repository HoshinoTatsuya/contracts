import { stableJson } from '../shape/stable-json';
import type { SnapshotDocument } from '../types/snapshot-document.type';

/** Равенство снимков по содержанию, а не по тексту: форматтер репозитория его не меняет. */
export function snapshotsEqual(a: SnapshotDocument, b: SnapshotDocument): boolean {
  return stableJson(a) === stableJson(b);
}
