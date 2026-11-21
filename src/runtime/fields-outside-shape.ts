import { validateAgainstShape } from '../compare/validate-against-shape';
import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { canonicalShape } from '../shape/canonical-shape';
import { ownField } from '../shape/own-field';
import type { Shape } from '../types/shape.type';
import { isPlainObject } from './is-plain-object';

/**
 * Поля значения, которых ФОРМА (вход контракта, то, что видит снимок) не
 * объявляет, — сравнение по описанию контракта, а не по выходу разбора.
 *
 * Выход разбора для этого не годится: `transform` переименовывает и убирает
 * ключи (прочитанное поле выглядело бы выброшенным), объединение возвращает
 * первый подошедший вариант (поле второго варианта выглядело бы лишним), а
 * экземпляр класса и `transform`, меняющий длину массива, сравнить с выходом
 * нельзя вовсе.
 *
 * - объединение — вариант, который принимает значение по форме и объявляет
 *   больше всего его полей (поле, объявленное хоть одним принимающим
 *   вариантом, — в контракте);
 * - `unknown` — объявленно «что угодно», лишнего в нём нет;
 * - объект с `keep` — лишние поля объявлены (`rest`);
 * - непрозрачный узел — по его границе `upper`; граница «что угодно»
 *   (`preprocess`, `coerce`, `transform` без формы входа) про поля ничего не
 *   говорит: такой путь — в `undetermined`, а не «лишнего нет».
 *
 * `collapse` — индексы массивов свёрнуты в `[]` (пути для метки метрики).
 */
export function fieldsOutsideShape(
  value: unknown,
  shape: Shape,
  options: { readonly collapse?: boolean } = {},
): { readonly outside: string[]; readonly undetermined: string[] } {
  interface Found {
    readonly outside: string[];
    readonly undetermined: string[];
  }
  const none = (): Found => ({ outside: [], undetermined: [] });
  const merge = (parts: readonly Found[]): Found => ({
    outside: parts.flatMap((part) => part.outside),
    undetermined: parts.flatMap((part) => part.undetermined),
  });
  const join = (path: string, name: string): string => (path === '' ? name : `${path}.${name}`);
  const index = (path: string, at: number): string => `${path}[${options.collapse === true ? '' : at}]`;
  const hasContent = (current: unknown): boolean =>
    (Array.isArray(current) && current.length > 0) ||
    (typeof current === 'object' &&
      current !== null &&
      !Array.isArray(current) &&
      Object.keys(current).length > 0);

  const visit = (current: unknown, node: Shape, path: string, depth: number): Found => {
    if (depth > CONTRACT_FORMAT.MAX_SHAPE_DEPTH) {
      return { outside: [], undetermined: [path] };
    }
    switch (node.kind) {
      case 'opaque':
        if (node.upper.kind === 'unknown') {
          return hasContent(current) ? { outside: [], undetermined: [path] } : none();
        }
        return visit(current, node.upper, path, depth + 1);
      case 'object': {
        if (!isPlainObject(current)) {
          return hasContent(current) ? { outside: [], undetermined: [path] } : none();
        }
        const parts: Found[] = [];
        for (const name of Object.keys(current)) {
          const inner = current[name];
          if (inner === undefined) {
            continue;
          }
          const field = ownField(node.fields, name);
          if (field !== undefined) {
            parts.push(visit(inner, field.shape, join(path, name), depth + 1));
          } else if (node.unknownKeys === 'keep') {
            parts.push(visit(inner, node.rest ?? { kind: 'unknown' }, join(path, name), depth + 1));
          } else {
            parts.push({ outside: [join(path, name)], undetermined: [] });
          }
        }
        return merge(parts);
      }
      case 'record': {
        if (!isPlainObject(current)) {
          return hasContent(current) ? { outside: [], undetermined: [path] } : none();
        }
        return merge(
          Object.keys(current)
            .filter((name) => current[name] !== undefined)
            .map((name) => visit(current[name], node.value, join(path, name), depth + 1)),
        );
      }
      case 'array':
        return Array.isArray(current)
          ? merge(current.map((item, at) => visit(item, node.element, index(path, at), depth + 1)))
          : hasContent(current)
            ? { outside: [], undetermined: [path] }
            : none();
      case 'tuple': {
        if (!Array.isArray(current)) {
          return hasContent(current) ? { outside: [], undetermined: [path] } : none();
        }
        return merge(
          current.map((item, at) => {
            const own = node.items[at] ?? node.rest;
            return own === undefined
              ? { outside: [], undetermined: [index(path, at)] }
              : visit(item, own, index(path, at), depth + 1);
          }),
        );
      }
      case 'union': {
        const accepting = node.options.filter((option) => validateAgainstShape(current, option).length === 0);
        const candidates = (accepting.length > 0 ? accepting : node.options).map((option) =>
          visit(current, option, path, depth + 1),
        );
        const ranked = [...candidates].sort(
          (a, b) =>
            a.outside.length +
            a.undetermined.length * 1000 -
            (b.outside.length + b.undetermined.length * 1000),
        );
        const [best] = ranked;
        if (best === undefined) {
          return none();
        }
        // Ни один вариант не принимает значение по форме, а схема его приняла: форма не та — не доказано.
        return accepting.length > 0 || !hasContent(current)
          ? best
          : { outside: best.outside, undetermined: [...best.undetermined, path] };
      }
      default:
        return none();
    }
  };

  const unique = (paths: readonly string[]): string[] => [...new Set(paths)];
  const found = visit(value, canonicalShape(shape), '', 0);
  return { outside: unique(found.outside), undetermined: unique(found.undetermined) };
}
