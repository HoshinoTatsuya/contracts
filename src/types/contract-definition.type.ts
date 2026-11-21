import type { ContractObserver } from './contract-observer.type';

/** Описание контракта для `defineContract`. */
export interface ContractDefinition<S, W> {
  /** Имя контракта: ключ в снимке, по нему сверяются стороны. */
  readonly name: string;
  /** `MAJOR.MINOR[.PATCH]`. Мажор — граница отказа читателя. */
  readonly version: string;
  /** Схема Zod 4 формы payload (без поля версии). */
  readonly schema: S;
  /**
   * Значения на проводе: имя очереди, ключи Redis (строкой или построителем
   * `(id) => \`…${id}\``), маршруты, потолки. Попадают в снимок и сверяются со
   * второй стороной.
   */
  readonly wire?: W;
  /** Поле версии в payload; `null` — версия не едет (по умолчанию `contractVersion`). */
  readonly versionField?: string | null;
  /**
   * Неизвестные поля при чтении: `strip` — выбросить (по умолчанию), `keep` —
   * сохранить в результате (сервис, который пересылает или сохраняет payload,
   * не теряет полей нового писателя). Так или иначе о них сообщает
   * `observer.unknownFields`. Писатель при `strip` не вправе класть поле вне
   * контракта.
   */
  readonly unknownFields?: 'strip' | 'keep';
  /**
   * Версия, которой считать payload без поля версии, — для писателей, чья
   * выкатка была до введения версии. Не задана — такой payload отвергается.
   */
  readonly legacyVersion?: string;
  /** Образцы payload (без поля версии): проверяются схемой при объявлении и едут в снимок. */
  readonly examples?: readonly unknown[];
  readonly observer?: ContractObserver;
}
