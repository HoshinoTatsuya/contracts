/**
 * Регулярное выражение из литерала снимка `/источник/флаги` (`patternLiteral`)
 * — ровно с теми флагами, с какими его проверяет схема. Не литерал или
 * неразбираемое выражение — `null`: вызывающий решает, отказ это или нарушение.
 */
export function regexOf(literal: string): RegExp | null {
  const match = /^\/([\s\S]*)\/([imsuvy]*)$/.exec(literal);
  if (match === null) {
    return null;
  }
  try {
    return new RegExp(match[1] as string, match[2] as string);
  } catch {
    return null;
  }
}
