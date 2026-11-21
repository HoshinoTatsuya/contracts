import { ownField } from '../shape/own-field';
import { setOwn } from '../shape/set-own';
import type { FieldShape } from '../types/field-shape.type';
import type { Shape } from '../types/shape.type';

/**
 * Форма с полем, добавленным в корневой объект (в каждый вариант корневого
 * объединения, в обе границы непрозрачного узла). Так поле версии становится
 * частью сверки: писатель кладёт его в payload, читатель снимает своё перед
 * разбором. Объект, который это имя уже объявляет, не меняется: решает его
 * собственное объявление. Корень не объект — форма как есть.
 */
export function withRootField(shape: Shape, name: string, field: FieldShape): Shape {
  switch (shape.kind) {
    case 'object': {
      if (ownField(shape.fields, name) !== undefined) {
        return shape;
      }
      const fields: Record<string, FieldShape> = { ...shape.fields };
      setOwn(fields, name, field);
      return { ...shape, fields };
    }
    case 'union':
      return { kind: 'union', options: shape.options.map((option) => withRootField(option, name, field)) };
    case 'opaque':
      return {
        ...shape,
        upper: withRootField(shape.upper, name, field),
        ...(shape.lower === undefined ? {} : { lower: withRootField(shape.lower, name, field) }),
      };
    default:
      return shape;
  }
}
