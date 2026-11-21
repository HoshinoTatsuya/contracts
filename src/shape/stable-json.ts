import { sortedCopy } from './sorted-copy';

/** JSON с ключами по алфавиту: одинаковое значение — одинаковая строка. */
export function stableJson(value: unknown, indent?: number): string {
  return JSON.stringify(sortedCopy(value), null, indent);
}
