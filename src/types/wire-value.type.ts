/**
 * Значение «на проводе», которое обе стороны обязаны знать одинаково: имя
 * очереди, ключ Redis, маршрут, потолок времени. `template` — построитель
 * ключа: функция, чьи аргументы подставлены как `${0}`, `${1}` (`arity` —
 * число аргументов), так что имя параметра на сравнение не влияет, а порядок —
 * влияет.
 */
export type WireValue =
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'null' }
  | { readonly type: 'template'; readonly arity: number; readonly value: string };
