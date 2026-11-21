import type { Shape } from './shape.type';

/**
 * Поле объекта в снимке: форма значения и может ли поле отсутствовать на
 * проводе. `optional` — схема принимает отсутствие поля (так понимает его
 * читатель). `undefinedAccepted` — отсутствие схема отвергает, а явное
 * `undefined` принимает (`z.unknown()` с zod 4.4): писатель с такой схемой
 * вправе положить `undefined`, и по JSON поле пропадёт — для писателя поле
 * необязательно, для читателя обязательно.
 */
export interface FieldShape {
  readonly optional: boolean;
  readonly undefinedAccepted?: true;
  readonly shape: Shape;
}
