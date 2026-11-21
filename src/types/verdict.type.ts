import type { Finding } from './finding.type';

/**
 * Вердикт проверки. `ok` — нет ни нарушений, ни «не доказано». `unproven` —
 * совместимость, которую снимок не может ни доказать, ни опровергнуть
 * (`coerce`, `transform`, `refine` читателя…): красное, пока его не внесли в
 * известные расхождения с причиной. Замечания (`notes`) вердикт не портят:
 * это то, что дойдёт, но молча потеряется или не используется.
 */
export interface Verdict {
  readonly ok: boolean;
  readonly violations: readonly Finding[];
  readonly unproven: readonly Finding[];
  readonly notes: readonly Finding[];
}
