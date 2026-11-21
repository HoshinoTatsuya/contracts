import type { Shape } from '../types/shape.type';

/**
 * Узел, который меняет только ВЫХОД разбора, а принимает ровно то же, что
 * `shape` (`default`, `trim`, `toLowerCase`): сверка приёма по нему точная
 * (без «не доказано»), а зеркало видит, что копии понимают значение
 * по-разному. `semantics` — описание поведения без функций пользователя; нет
 * его (функция по умолчанию, своя `overwrite`) — совпадение копий не
 * доказывает одинаковый выход.
 */
export function exactShape(reason: string, shape: Shape, semantics?: string): Shape {
  return {
    kind: 'opaque',
    reason,
    upper: shape,
    exact: true,
    ...(semantics === undefined ? {} : { semantics }),
  };
}
