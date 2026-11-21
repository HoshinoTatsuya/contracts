import type { ShapeOf } from '../types/shape-of.type';
import { withoutUndefined } from './without-undefined';

/**
 * Сколько членов кортеж требует: снятое с поведения схемы (`minItems`) или,
 * если его нет, — все, кроме идущих в конце членов, принимающих `undefined`
 * (`[string, number?]` — от одного).
 */
export function tupleMinimum(shape: ShapeOf<'tuple'>): number {
  if (shape.minItems !== undefined) {
    return shape.minItems;
  }
  let minimum = shape.items.length;
  while (minimum > 0 && withoutUndefined(shape.items[minimum - 1] as never).hadUndefined) {
    minimum -= 1;
  }
  return minimum;
}
