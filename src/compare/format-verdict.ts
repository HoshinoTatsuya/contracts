import type { Verdict } from '../types/verdict.type';
import { findingKey } from './finding-key';

/** Вердикт текстом для отчёта CLI и сообщения гейта: нарушения, «не доказано», затем замечания. */
export function formatVerdict(verdict: Verdict, title = 'контракты'): string {
  const counts = [
    verdict.violations.length > 0 ? `НАРУШЕНИЙ ${verdict.violations.length}` : '',
    verdict.unproven.length > 0 ? `НЕ ДОКАЗАНО ${verdict.unproven.length}` : '',
    `замечаний ${verdict.notes.length}`,
  ].filter((part) => part !== '');
  const lines = [
    verdict.ok
      ? `${title}: совместимо (замечаний ${verdict.notes.length})`
      : `${title}: ${counts.join(', ')}`,
  ];
  for (const finding of verdict.violations) {
    lines.push(`  ✗ [${findingKey(finding)}] ${finding.message}`);
  }
  for (const finding of verdict.unproven) {
    lines.push(`  ? [${findingKey(finding)}] ${finding.message}`);
  }
  for (const finding of verdict.notes) {
    lines.push(`  · [${findingKey(finding)}] ${finding.message}`);
  }
  return lines.join('\n');
}
