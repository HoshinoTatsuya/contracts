import { toVerdict } from '../compare/to-verdict';
import { FINDING_CODE } from '../constants/finding-code.constant';
import type { Finding } from '../types/finding.type';
import type { Verdict } from '../types/verdict.type';

/**
 * Маршруты контракта ↔ обработчики, в обе стороны: у каждого маршрута ровно
 * один обработчик (ноль — «no handler» у вызывающего, два — ответит тот, кто
 * зарегистрировался позже), у каждого обработчика — маршрут контракта.
 * Откуда брать обработчики (граф модулей фреймворка, реестр), решает
 * вызывающий: библиотека судит множества, а не фреймворк.
 *
 * Исключения — с причиной: `unhandled` (маршрут законно без обработчика здесь)
 * и `foreign` (обработчик чужого контракта). Запись, которой больше нечего
 * прикрывать, — нарушение: устаревшее допущение прикрыло бы следующее.
 */
export function checkRoutes(input: {
  readonly declared: readonly string[];
  readonly handled: readonly string[];
  readonly unhandled?: Readonly<Record<string, string>>;
  readonly foreign?: Readonly<Record<string, string>>;
}): Verdict {
  const violations: Finding[] = [];
  const counts = new Map<string, number>();
  for (const route of input.handled) {
    counts.set(route, (counts.get(route) ?? 0) + 1);
  }
  const declared = new Set(input.declared);
  const unhandled = input.unhandled ?? {};
  const foreign = input.foreign ?? {};
  const add = (route: string, code: Finding['code'], message: string): void => {
    violations.push({ contract: route, code, path: '', message: `маршрут «${route}»: ${message}` });
  };
  for (const route of declared) {
    const count = counts.get(route) ?? 0;
    if (count === 0 && !Object.hasOwn(unhandled, route)) {
      add(route, FINDING_CODE.routeUnhandled, 'объявлен в контракте, обработчика нет');
    } else if (count > 0 && Object.hasOwn(unhandled, route)) {
      add(
        route,
        FINDING_CODE.routeUnhandled,
        'записан как необслуживаемый, а обработчик есть — запись устарела',
      );
    }
    if (count > 1) {
      add(route, FINDING_CODE.routeDuplicated, `обработчиков ${count}`);
    }
  }
  for (const route of counts.keys()) {
    if (!declared.has(route) && !Object.hasOwn(foreign, route)) {
      add(route, FINDING_CODE.routeUndeclared, 'обработчик есть, в контракте маршрута нет');
    } else if (!declared.has(route) && (counts.get(route) ?? 0) > 1) {
      add(route, FINDING_CODE.routeDuplicated, `обработчиков ${counts.get(route)}`);
    }
  }
  for (const route of Object.keys(unhandled)) {
    if (!declared.has(route)) {
      add(
        route,
        FINDING_CODE.routeUnhandled,
        'записан как необслуживаемый, а в контракте его нет — запись устарела',
      );
    }
  }
  for (const route of Object.keys(foreign)) {
    if (!counts.has(route) || declared.has(route)) {
      add(
        route,
        FINDING_CODE.routeUndeclared,
        'записан как чужой, а обработчика нет или маршрут свой — запись устарела',
      );
    }
  }
  return toVerdict(violations, [], []);
}
