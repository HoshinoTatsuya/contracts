import type { Finding } from '../types/finding.type';
import type { KnownOutcome } from '../types/known-outcome.type';
import type { Verdict } from '../types/verdict.type';
import { findingKey } from './finding-key';

/**
 * Известные расхождения — адресно (`findingKey`) и с причиной. Запись может
 * адресовать нарушение, «не доказано» или замечание: допущенная находка уходит
 * из вердикта. Запись, которой не соответствует ни одна находка, —
 * устаревшая (иначе допущение пережило бы починку и прикрыло бы следующее
 * расхождение по тому же адресу); запись с причиной короче `minReasonLength`
 * — необъяснённая.
 */
export function applyKnown(
  verdict: Verdict,
  known: Readonly<Record<string, string>>,
  minReasonLength = 30,
): KnownOutcome {
  const all = [...verdict.violations, ...verdict.unproven, ...verdict.notes];
  const keys = new Set(all.map(findingKey));
  const open = (findings: readonly Finding[]): Finding[] =>
    findings.filter((finding) => !Object.hasOwn(known, findingKey(finding)));
  const violations = open(verdict.violations);
  const unproven = open(verdict.unproven);
  return {
    verdict: {
      ok: violations.length === 0 && unproven.length === 0,
      violations,
      unproven,
      notes: open(verdict.notes),
    },
    stale: Object.keys(known)
      .filter((key) => !keys.has(key))
      .sort(),
    unexplained: Object.entries(known)
      .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < minReasonLength)
      .map(([key]) => key)
      .sort(),
  };
}
