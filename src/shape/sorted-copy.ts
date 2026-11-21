/**
 * Копия значения JSON с ключами объектов по алфавиту на всех уровнях; порядок
 * массивов сохраняется. Основа детерминированного снимка: порядок объявления
 * полей в схеме на снимок не влияет. Поле `undefined` и отсутствующее поле —
 * одна запись (как в JSON), `-0` и `0` — тоже; цикл — `TypeError`.
 */
export function sortedCopy(value: unknown, ancestors: readonly object[] = []): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (ancestors.includes(value)) {
    // Циклическую структуру JSON не записать: отказ с понятным текстом, а не переполнение стека.
    throw new TypeError('циклическая ссылка: значение не записать в JSON');
  }
  const chain = [...ancestors, value];
  if (Array.isArray(value)) {
    return value.map((inner) => sortedCopy(inner, chain));
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, inner]) => inner !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, inner]) => [key, sortedCopy(inner, chain)]));
}
