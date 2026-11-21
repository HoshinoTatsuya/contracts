import type { Shape } from '../types/shape.type';

/**
 * Поведение формы описано целиком: в ней нет непрозрачного узла без
 * `semantics` (функции пользователя, своей `overwrite`, `refine`…). Только
 * такие узлы можно считать одинаковыми по записи: `default` вокруг `transform`
 * одинаков по записи у двух копий, а функции внутри — нет.
 */
export function determined(shape: Shape): boolean {
  switch (shape.kind) {
    case 'opaque':
      return (
        shape.semantics !== undefined &&
        determined(shape.upper) &&
        (shape.lower === undefined || determined(shape.lower))
      );
    case 'object':
      return (
        Object.values(shape.fields).every((field) => determined(field.shape)) &&
        (shape.rest === undefined || determined(shape.rest))
      );
    case 'record':
      return determined(shape.key) && determined(shape.value);
    case 'array':
      return determined(shape.element);
    case 'tuple':
      return shape.items.every(determined) && (shape.rest === undefined || determined(shape.rest));
    case 'union':
      return shape.options.every(determined);
    default:
      return true;
  }
}
