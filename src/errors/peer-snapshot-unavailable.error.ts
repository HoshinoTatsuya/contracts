/**
 * Снимок другой стороны не добыт: файла нет, ревизии нет, клон не удался,
 * формат чужой. Это ОТКАЗ проверки: «не смогли проверить» и «проверено» —
 * разные ответы, и пропуск здесь был бы зелёной галочкой за непроверенным.
 */
export class PeerSnapshotUnavailableError extends Error {
  public override readonly name = 'PeerSnapshotUnavailableError';

  public constructor(
    public readonly source: string,
    public readonly reason: string,
  ) {
    super(`снимок другой стороны не добыт (${source}): ${reason}`);
  }
}
