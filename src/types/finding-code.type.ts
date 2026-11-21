import type { FINDING_CODE } from '../constants/finding-code.constant';

/** Код находки: `field-required-missing`, `wire-value-unknown`… */
export type FindingCode = (typeof FINDING_CODE)[keyof typeof FINDING_CODE];
