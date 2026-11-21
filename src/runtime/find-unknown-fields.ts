import { isPlainObject } from './is-plain-object';

/**
 * Поля входа, которых нет в разобранном выходе, — то, что схема молча
 * выбросила. Сравниваются вход и выход одного разбора, поэтому для объединений
 * учитывается ровно тот вариант, который схема выбрала.
 *
 * Обход — явным стеком, а не рекурсией: payload под `z.unknown()` бывает
 * глубже стека вызовов (JSON.parse его переживает). Значение, которое схема
 * пропустила тем же объектом (`unknown`, лишние поля открытого объекта), не
 * обходится вовсе: выбросить из него схема ничего не могла.
 *
 * `collapse` — индексы массивов сворачиваются в `[]`, повторы убираются
 * (`items[].extra` один раз на весь массив): так пути пригодны для метки
 * метрики. `unaligned` получает пути, где вход и выход сопоставить нельзя
 * (экземпляр класса, массив другой длины, объект против массива): там
 * «лишнего не найдено» не значит «лишнего нет».
 */
export function findUnknownFields(
  input: unknown,
  output: unknown,
  options: { readonly collapse?: boolean; readonly unaligned?: (path: string) => void } = {},
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const report = (path: string): void => {
    if (!seen.has(path)) {
      seen.add(path);
      found.push(path);
    }
  };
  const stack: Array<readonly [unknown, unknown, string]> = [[input, output, '']];
  while (stack.length > 0) {
    const [from, to, path] = stack.pop() as readonly [unknown, unknown, string];
    if (from === to) {
      continue;
    }
    if (isPlainObject(from) && isPlainObject(to)) {
      const children: Array<readonly [unknown, unknown, string]> = [];
      for (const key of Object.keys(from)) {
        if (from[key] === undefined) {
          continue;
        }
        const child = path === '' ? key : `${path}.${key}`;
        if (Object.hasOwn(to, key)) {
          children.push([from[key], to[key], child]);
        } else {
          report(child);
        }
      }
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index] as readonly [unknown, unknown, string]);
      }
    } else if (Array.isArray(from) && Array.isArray(to) && from.length === to.length) {
      const children: Array<readonly [unknown, unknown, string]> = [];
      for (let index = 0; index < from.length; index += 1) {
        children.push([from[index], to[index], `${path}[${options.collapse === true ? '' : index}]`]);
      }
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index] as readonly [unknown, unknown, string]);
      }
    } else if (
      typeof from === 'object' &&
      from !== null &&
      (Array.isArray(from) ? from.length > 0 : Object.keys(from).length > 0)
    ) {
      // Во входе есть что терять, а выход с ним не сопоставляется.
      options.unaligned?.(path);
    }
  }
  return found;
}
