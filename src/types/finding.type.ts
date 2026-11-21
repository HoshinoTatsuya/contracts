import type { FindingCode } from './finding-code.type';

/**
 * Находка проверки: нарушение или замечание. `path` — путь к полю внутри
 * payload (`meta.httpCode`, `items[]`, `{kind=found}.payload`), пустая строка —
 * контракт целиком; для значений на проводе — `wire:<путь>`.
 */
export interface Finding {
  readonly contract: string;
  readonly code: FindingCode;
  readonly path: string;
  readonly message: string;
}
