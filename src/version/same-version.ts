import { compareVersions } from './compare-versions';
import { parseVersion } from './parse-version';

/** Одна ли это версия: сравниваются разобранные (`1.2` и `1.2.0` — одна), неразобранные и `null` — как есть. */
export function sameVersion(a: string | null, b: string | null): boolean {
  if (a === b) {
    return true;
  }
  const left = parseVersion(a);
  const right = parseVersion(b);
  return left !== null && right !== null && compareVersions(left, right) === 0;
}
