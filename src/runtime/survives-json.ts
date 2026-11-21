/**
 * Значение переживает JSON без потерь: после `JSON.stringify`/`JSON.parse`
 * получается то же самое. `Date` (едет строкой), `undefined` в массиве (едет
 * `null`), `NaN` и бесконечность (едут `null`), `bigint` (stringify
 * отказывает), функция, цикл, экземпляр класса — не переживают. Поле объекта
 * со значением `undefined` пропадает — это и есть отсутствие поля, не потеря.
 */
export function survivesJson(value: unknown): boolean {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return false;
  }
  if (text === undefined) {
    return false;
  }
  const same = (before: unknown, after: unknown): boolean => {
    if (before === after) {
      return true;
    }
    if (Array.isArray(before)) {
      return (
        Array.isArray(after) &&
        before.length === after.length &&
        before.every((item, index) => same(item, after[index]))
      );
    }
    if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) {
      return false;
    }
    const prototype = Object.getPrototypeOf(before) as unknown;
    if ((prototype !== Object.prototype && prototype !== null) || Array.isArray(after)) {
      return false;
    }
    const kept = Object.keys(before).filter((key) => (before as Record<string, unknown>)[key] !== undefined);
    const arrived = Object.keys(after);
    return (
      kept.length === arrived.length &&
      kept.every(
        (key) =>
          Object.hasOwn(after, key) &&
          same((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key]),
      )
    );
  };
  return same(value, JSON.parse(text) as unknown);
}
