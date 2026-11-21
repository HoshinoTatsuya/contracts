import type { Finding } from '../types/finding.type';
import type { Verdict } from '../types/verdict.type';
import { sortFindings } from './sort-findings';

/** Вердикт из находок: `ok` — нет ни нарушений, ни «не доказано». */
export function toVerdict(
  violations: readonly Finding[],
  unproven: readonly Finding[],
  notes: readonly Finding[],
): Verdict {
  const sorted = sortFindings(violations);
  const doubtful = sortFindings(unproven);
  return {
    ok: sorted.length === 0 && doubtful.length === 0,
    violations: sorted,
    unproven: doubtful,
    notes: sortFindings(notes),
  };
}
