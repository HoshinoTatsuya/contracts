import { regexOf } from './regex-of';

/**
 * Выражение, которым zod проверяет формат ЦЕЛИКОМ, из записи формата
 * (`uuid{"pattern":"/…/"}`). Формат, который zod проверяет ещё и функцией
 * (в записи — версия zod), формат без выражения и неразбираемая запись —
 * `undefined`: проверить его снимком нечем.
 */
export function formatRule(format: string): RegExp | undefined {
  const brace = format.indexOf('{');
  if (brace < 0) {
    return undefined;
  }
  try {
    const params = JSON.parse(format.slice(brace)) as Record<string, unknown>;
    return typeof params.pattern === 'string' && params.zod === undefined
      ? (regexOf(params.pattern) ?? undefined)
      : undefined;
  } catch {
    return undefined;
  }
}
