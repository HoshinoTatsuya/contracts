import type { ParsedVersion } from '../types/parsed-version.type';

/** `MAJOR.MINOR[.PATCH]` без префикса и суффиксов; иначе `null`. */
export function parseVersion(version: unknown): ParsedVersion | null {
  if (typeof version !== 'string') {
    return null;
  }
  const match = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:\.(0|[1-9]\d{0,8}))?$/.exec(version);
  if (match === null) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}
