import { describeThrown } from './describe-thrown';

/** Путь отклонения Standard Schema (`['meta', { key: 'httpCode' }]`) строкой `meta.httpCode`. */
export function issuePath(
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): string {
  return (path ?? [])
    .map((segment) => (typeof segment === 'object' && segment !== null ? segment.key : segment))
    .map((segment) => describeThrown(segment))
    .join('.');
}
