import { ContractDefinitionError } from '../errors/contract-definition.error';
import { describeThrown } from '../runtime/describe-thrown';
import { setOwn } from '../shape/set-own';
import type { WireValue } from '../types/wire-value.type';

/**
 * Значения на проводе по путям: вложенные объекты — через точку (`keys.lock`),
 * массивы — индексом (`statuses[0]`). Функция — построитель ключа: вызывается
 * с подстановками `${0}`, `${1}` по числу параметров и обязана вернуть строку
 * (`(id) => \`scan:lock:${id}\`` → `scan:lock:${0}`); построитель, который
 * считает что-то по аргументу (хэш, ветвление), даёт значение, не похожее на
 * ключ, — это видно в снимке. Значение без формы на проводе (символ, NaN,
 * бесконечность, класс) — отказ.
 */
export function wireFromValues(wire: unknown, contract = 'контракт'): Record<string, WireValue> {
  const values: Record<string, WireValue> = {};
  const seen = new Set<unknown>();

  const visit = (path: string, value: unknown): void => {
    const fail = (detail: string): never => {
      throw new ContractDefinitionError(contract, `wire:${path}`, detail);
    };
    // Ключ «a.b» и вложенный a: { b } дают один путь: второе значение молча затёрло бы первое.
    const put = (entry: WireValue): void => {
      if (Object.hasOwn(values, path)) {
        fail('два значения дают один путь (ключ с точкой или скобками рядом с вложенным объектом)');
      }
      setOwn(values, path, entry);
    };
    if (typeof value === 'string') {
      put({ type: 'string', value });
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        fail(`число без записи в JSON: ${value}`);
      }
      put({ type: 'number', value });
    } else if (typeof value === 'boolean') {
      put({ type: 'boolean', value });
    } else if (value === null) {
      put({ type: 'null' });
    } else if (typeof value === 'function') {
      const arity = value.length;
      // `length` не считает параметры со значением по умолчанию и rest: такой построитель
      // записался бы с умолчанием вместо подстановки — отказ, а не неверный шаблон.
      // Список параметров в скобках; стрелка без скобок (`id => …`) — один простой параметр.
      const params = /^[^(=]*\(([^)]*)\)/.exec(Function.prototype.toString.call(value))?.[1] ?? '';
      if (/[=.]/.test(params)) {
        fail('у построителя ключа параметр по умолчанию или rest: число подстановок не определить');
      }
      let rendered: unknown;
      try {
        rendered = (value as (...args: string[]) => unknown)(
          ...Array.from({ length: arity }, (_, index) => `\${${index}}`),
        );
      } catch (error) {
        fail(
          `построитель ключа упал на подстановках \${0}…: ${describeThrown(error, 'message')} — он считает по аргументу, а не собирает строку`,
        );
        return;
      }
      if (typeof rendered !== 'string') {
        fail(`построитель ключа вернул не строку: ${typeof rendered}`);
      }
      put({ type: 'template', arity, value: rendered as string });
    } else if (typeof value === 'object') {
      // seen — текущий путь обхода, а не все встреченные: общий подобъект в двух местах — не цикл.
      if (seen.has(value)) {
        fail('циклическая ссылка');
      }
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((inner, index) => {
          visit(`${path}[${index}]`, inner);
        });
      } else {
        const prototype = Object.getPrototypeOf(value) as unknown;
        if (prototype !== Object.prototype && prototype !== null) {
          fail('значение на проводе — не простой объект');
        }
        for (const key of Object.keys(value)) {
          visit(path === '' ? key : `${path}.${key}`, (value as Record<string, unknown>)[key]);
        }
      }
      seen.delete(value);
    } else {
      fail(`значение без формы на проводе: ${typeof value}`);
    }
  };

  visit('', wire ?? {});
  return values;
}
