/**
 * Брошенное (или любое чужое) значение строкой для текста отказа, которая сама
 * не бросает. `named` — у ошибки «Имя: сообщение» (`SyntaxError: Unexpected
 * token`, а не `[object Object]`), `message` — только сообщение; остальное —
 * как `String(value)`.
 *
 * `String()` на значении без прототипа (`Object.create(null)`), с бросающим
 * `toString` / `Symbol.toPrimitive`, как и бросающий геттер `message`, бросает
 * — в ветке, которая разбирает отказ, исходная причина подменилась бы этим
 * исключением. Тогда — `message`, если это строка, иначе тег объекта
 * (`[object Object]`).
 */
export function describeThrown(error: unknown, form: 'named' | 'message' = 'named'): string {
  try {
    if (error instanceof Error) {
      return form === 'message' ? String(error.message) : `${String(error.name)}: ${String(error.message)}`;
    }
    return String(error);
  } catch {
    let message: unknown;
    try {
      message = (error as { message?: unknown } | null | undefined)?.message;
    } catch {
      message = undefined;
    }
    if (typeof message === 'string') {
      return message;
    }
    try {
      return Object.prototype.toString.call(error);
    } catch {
      // Отозванный Proxy бросает даже на теге объекта.
      return '[значение без текста]';
    }
  }
}
