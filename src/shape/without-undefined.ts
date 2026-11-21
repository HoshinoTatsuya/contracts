import type { Shape } from '../types/shape.type';
import { canonicalShape } from './canonical-shape';

/**
 * Форма без `undefined` — для поля объекта, где отсутствие выражается флагом
 * `optional`, а не вариантом: по JSON поле со значением `undefined` пропадает.
 * У непрозрачного узла `undefined` снимается с обеих границ.
 */
export function withoutUndefined(shape: Shape): { readonly shape: Shape; readonly hadUndefined: boolean } {
  const canonical = canonicalShape(shape);
  if (canonical.kind === 'undefined') {
    return { shape: { kind: 'never' }, hadUndefined: true };
  }
  if (canonical.kind === 'opaque') {
    const upper = withoutUndefined(canonical.upper);
    const lower = canonical.lower === undefined ? undefined : withoutUndefined(canonical.lower).shape;
    return {
      shape: canonicalShape({
        ...canonical,
        upper: upper.shape,
        ...(lower === undefined ? {} : { lower }),
      }),
      hadUndefined: upper.hadUndefined,
    };
  }
  if (canonical.kind !== 'union' || !canonical.options.some((option) => option.kind === 'undefined')) {
    return { shape: canonical, hadUndefined: false };
  }
  return {
    shape: canonicalShape({
      kind: 'union',
      options: canonical.options.filter((option) => option.kind !== 'undefined'),
    }),
    hadUndefined: true,
  };
}
