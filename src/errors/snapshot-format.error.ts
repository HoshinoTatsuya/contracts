/**
 * Документ не является снимком контрактов этого формата: не JSON, чужое поле
 * `format`, неизвестный вид формы. Отказ, а не «пустой снимок»: пустой снимок
 * сделал бы любую сверку зелёной.
 */
export class SnapshotFormatError extends Error {
  public override readonly name = 'SnapshotFormatError';

  public constructor(
    public readonly source: string,
    detail: string,
  ) {
    super(`${source}: не снимок контрактов: ${detail}`);
  }
}
