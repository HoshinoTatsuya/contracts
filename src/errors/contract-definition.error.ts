/**
 * Контракт описан так, что его форму нельзя снять однозначно: вид схемы, у
 * которого нет формы на проводе (функция, промис, рекурсия), неразобранная
 * версия, неверный построитель ключа. «Не смог разобрать» — отказ, а не
 * пропуск: иначе снимок молча не содержал бы части контракта.
 */
export class ContractDefinitionError extends Error {
  public override readonly name = 'ContractDefinitionError';

  public constructor(
    public readonly contract: string,
    public readonly path: string,
    detail: string,
  ) {
    super(`${contract}${path === '' ? '' : ` (${path})`}: ${detail}`);
  }
}
