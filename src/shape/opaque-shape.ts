import type { Shape } from '../types/shape.type';

/**
 * Непрозрачный узел: `upper` — надмножество принимаемого, `lower` —
 * подмножество, принятое наверняка (нет — наверняка ничего). Вложенные
 * непрозрачные узлы схлопываются: у границы берётся её же граница, причины
 * перечисляются через «; ».
 */
export function opaqueShape(reason: string, upper: Shape, lower?: Shape): Shape {
  const reasons = [reason];
  let top = upper;
  if (top.kind === 'opaque') {
    reasons.push(top.reason);
    top = top.upper;
  }
  let bottom = lower;
  if (bottom !== undefined && bottom.kind === 'opaque') {
    bottom = bottom.lower;
  }
  return {
    kind: 'opaque',
    reason: [...new Set(reasons)].join('; '),
    upper: top,
    ...(bottom === undefined ? {} : { lower: bottom }),
  };
}
