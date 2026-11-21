/**
 * Сверку двух форм нельзя довести до ответа: она ушла глубже потолка
 * (`CONTRACT_FORMAT.MAX_COMPARE_DEPTH`). Настоящая форма конечна и неглубока,
 * поэтому это либо петля в самой сверке, либо форма, которую никто не стал бы
 * писать руками. Отказ, а не «совместимо» и не переполнение стека: «не смог
 * сверить» и «нарушений нет» — разные ответы.
 */
export class ShapeComparisonError extends Error {
  public override readonly name = 'ShapeComparisonError';

  public constructor(
    public readonly contract: string,
    public readonly path: string,
    detail: string,
  ) {
    super(`${contract}${path === '' ? '' : ` (${path})`}: ${detail}`);
  }
}
