import type { ParsedVersion } from '../types/parsed-version.type';

/** Порядок версий: отрицательное — `a` раньше `b`. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
