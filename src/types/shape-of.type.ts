import type { Shape } from './shape.type';

/** Член `Shape` данного вида: `ShapeOf<'object'>`. */
export type ShapeOf<K extends Shape['kind']> = Extract<Shape, { readonly kind: K }>;
