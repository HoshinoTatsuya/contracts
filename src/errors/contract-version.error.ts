import { shownValue } from '../runtime/shown-value';

/**
 * Версия в payload не позволяет его читать: нет поля версии (и не задана
 * прежняя версия для старых писателей), версия не разобрана или мажор чужой.
 * Чужой мажор — отказ, а не «попробуем»: форма через мажор несовместима по
 * определению, и терпимое чтение превратило бы её в тихую порчу данных.
 */
export class ContractVersionError extends Error {
  public override readonly name = 'ContractVersionError';

  public constructor(
    public readonly contract: string,
    public readonly reason: 'missing' | 'malformed' | 'foreign-major',
    public readonly received: unknown,
    public readonly expected: string,
  ) {
    super(
      reason === 'missing'
        ? `${contract}: в payload нет версии контракта (ожидалась ${expected})`
        : reason === 'malformed'
          ? `${contract}: версия контракта не разобрана: ${shownValue(received)} (ожидалась ${expected})`
          : `${contract}: версия ${String(received)} — чужой мажор, читатель понимает ${expected}`,
    );
  }
}
