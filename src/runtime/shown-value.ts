import { describeThrown } from './describe-thrown';

/**
 * Значение из payload или образца для текста отклонения: JSON, а число —
 * как есть (NaN и бесконечность JSON показал бы как null). Сериализация сама
 * бросает на BigInt внутри, цикле, бросающем `toJSON` или геттере — тогда
 * отклонение не подменяется исключением: текст строит `describeThrown`.
 */
export function shownValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? describeThrown(value);
  } catch {
    return describeThrown(value);
  }
}
