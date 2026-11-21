import type { Verdict } from './verdict.type';

/**
 * Вердикт после известных расхождений: `verdict` — без допущенных нарушений,
 * `stale` — записи, которым нарушение больше не соответствует (устарели —
 * убрать), `unexplained` — записи без внятной причины.
 */
export interface KnownOutcome {
  readonly verdict: Verdict;
  readonly stale: readonly string[];
  readonly unexplained: readonly string[];
}
