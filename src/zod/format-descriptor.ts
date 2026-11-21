import { patternLiteral } from '../shape/pattern-literal';
import { stableJson } from '../shape/stable-json';
import type { ZodDef } from '../types/zod-def.type';

/**
 * Формат строки в снимке — имя, параметры И то, чем он проверяется: `uuid`
 * и `uuid{"version":"v4"}`, `datetime{"offset":true,"precision":0}`,
 * `url{"protocol":"/^https$/"}` — разные правила, и одно имя на оба давало
 * «совместимо» там, где читатель отвергает.
 *
 * Регулярное выражение формата (`pattern`) пишется ВСЕГДА, в том числе
 * умолчание zod: оно меняется от минора к минору (`ulid` 4.4 → 4.6, `cuid`,
 * `emoji`, `e164`), и стороны на разных минорах zod принимают разное при
 * одинаковом имени. Встроенный формат, который zod проверяет ещё и функцией
 * (`url`, `jwt`, `ipv6`, `cidrv6`, `base64`, `iban`…), выражением не
 * описывается — в запись идёт версия zod (`"zod":"4.6.5"`): другая версия —
 * «не доказано», а не молчаливое «совместимо». Обновление zod поэтому может
 * изменить снимок — это изменение приёма, его видно в диффе.
 *
 * Параметры по умолчанию (`false`, `null`, нет значения) и служебные поля
 * описания (`checks` цепочки, `when`, `error`…) в запись не попадают.
 * Свой формат `z.stringFormat(имя, функция)` — `opaque`: что функция
 * принимает, снимок не знает, а встроенное имя её не прячет.
 */
export function formatDescriptor(
  check: ZodDef,
  instance?: unknown,
  zodVersion?: string,
): { readonly format: string; readonly opaque: boolean } {
  // Встроенные форматы, которые zod проверяет ТОЛЬКО выражением: выражение в записи описывает их целиком.
  const patternOnly = new Set([
    'email',
    'emoji',
    'uuid',
    'guid',
    'nanoid',
    'cuid',
    'cuid2',
    'ulid',
    'xid',
    'ksuid',
    'ipv4',
    'mac',
    'cidrv4',
    'e164',
    'hostname',
    'hex',
    'datetime',
    'date',
    'time',
    'duration',
    'lowercase',
    'uppercase',
    'starts_with',
    'ends_with',
    'includes',
    'currency_code',
  ]);
  const format = String(check.format);
  const hash = /^(?:md5|sha1|sha256|sha384|sha512)_(?:hex|base64|base64url)$/.test(format);
  const skip = new Set([
    'check',
    'checks',
    'coerce',
    'type',
    'format',
    'abort',
    'when',
    'error',
    'message',
    'fn',
    'pattern',
    '_zod',
  ]);
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(check)) {
    if (skip.has(key) || value === undefined || value === null || value === false) {
      continue;
    }
    params[key] = value instanceof RegExp ? patternLiteral(value.source, value.flags) : value;
  }
  const traits = (instance as { _zod?: { traits?: unknown } } | undefined)?._zod?.traits;
  // Формат, собранный через stringFormat (свой — или встроенный hostname/hex): описан своим выражением или функцией.
  const custom = traits instanceof Set && traits.has('$ZodCustomStringFormat');
  const pattern = check.pattern instanceof RegExp ? check.pattern : undefined;
  if (pattern !== undefined) {
    params.pattern = patternLiteral(pattern.source, pattern.flags);
  }
  if (!custom && !patternOnly.has(format) && !hash) {
    params.zod = zodVersion ?? 'неизвестна';
  }
  const callable = (value: unknown): boolean => typeof value === 'function' || typeof value === 'symbol';
  const shown = Object.fromEntries(Object.entries(params).filter(([, value]) => !callable(value)));
  return {
    format: Object.keys(shown).length === 0 ? format : `${format}${stableJson(shown)}`,
    // Своя функция проверки и параметр-функция — вне снимка.
    opaque: (custom && pattern === undefined) || Object.values(params).some(callable),
  };
}
