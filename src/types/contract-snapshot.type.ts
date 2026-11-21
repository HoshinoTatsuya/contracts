import type { ContractRole } from './contract-role.type';
import type { ExtraFieldsPolicy } from './extra-fields-policy.type';
import type { Shape } from './shape.type';
import type { WireValue } from './wire-value.type';

/** Один контракт в снимке стороны. */
export interface ContractSnapshot {
  readonly role: ContractRole;
  /** `MAJOR.MINOR[.PATCH]`: мажор — граница, через которую читатель отказывает. */
  readonly version: string;
  /** Поле версии в payload; `null` — версия на проводе не едет (контракт снят с TypeScript). */
  readonly versionField: string | null;
  /** Версия, которой читатель считает payload без поля версии; `null` — такой payload отвергается. */
  readonly legacyVersion: string | null;
  /** Что сторона-писатель делает с полями вне формы: отвергает при записи или пропускает на провод. */
  readonly extraFields: ExtraFieldsPolicy;
  readonly shape: Shape;
  /** Значения на проводе по путям (`queue`, `keys.lock`). */
  readonly wire: Readonly<Record<string, WireValue>>;
  /** Образцы payload писателя: читатель обязан их принять. */
  readonly examples: readonly unknown[];
}
