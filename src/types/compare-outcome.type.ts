import type { Finding } from './finding.type';

/**
 * Итог сверки одной пары: нарушения и «не доказано» роняют проверку,
 * замечания — нет. «Не доказано» — то, что форма не выражает (`coerce`,
 * `transform`, `refine`…): ни «совместимо», ни «несовместимо» про это сказать
 * нельзя, и молчаливое «совместимо» было бы ложью.
 */
export interface CompareOutcome {
  readonly violations: readonly Finding[];
  readonly unproven: readonly Finding[];
  readonly notes: readonly Finding[];
}
