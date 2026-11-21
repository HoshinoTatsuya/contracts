import type { Finding } from '../types/finding.type';
import { findingKey } from './finding-key';

/** Находки в детерминированном порядке: одинаковый вход — одинаковый отчёт. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const unique = new Map(findings.map((finding) => [`${findingKey(finding)}\n${finding.message}`, finding]));
  return [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, finding]) => finding);
}
