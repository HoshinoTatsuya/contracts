import type { PayloadIssue } from '../types/payload-issue.type';
import { describeThrown } from './describe-thrown';
import { issuePath } from './issue-path';

/**
 * Синхронный разбор Standard Schema с исходом, который нельзя перепутать.
 *
 * `~standard.validate` zod 4 ловит синхронное исключение схемы (`JSON.parse`
 * в `transform`, `new URL` в `refine`, дискриминатор через `lazy`) и уходит
 * в асинхронный разбор: вместо исключения возвращается ОТКЛОНЁННЫЙ Promise.
 * Брошенный мимо него отказ оставлял Promise без обработчика — и процесс
 * падал с кодом 1, хотя вызывающий ловил ошибку. Поэтому:
 *
 * - любой Promise из `validate` получает обработчик (отклонение не
 *   «необработанное»);
 * - причина устанавливается синхронно повторным разбором `_zod.run` в
 *   синхронном режиме: исключение схемы — `threw` с самим исключением,
 *   настоящая асинхронность (`async refine`) — `async`;
 * - схема без `_zod.run` (не zod) и Promise из `validate` — `async`: что
 *   внутри, синхронно не узнать, а «разобрано» сказать нельзя.
 */
export function validateStandard(
  schema: unknown,
  value: unknown,
):
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'issues'; readonly issues: ReadonlyArray<PayloadIssue & { readonly head?: string }> }
  | { readonly kind: 'threw'; readonly error: unknown }
  | { readonly kind: 'async' } {
  const thenable = (candidate: unknown): candidate is PromiseLike<unknown> =>
    (typeof candidate === 'object' || typeof candidate === 'function') &&
    candidate !== null &&
    typeof (candidate as { then?: unknown }).then === 'function';
  const silence = (pending: PromiseLike<unknown>): void => {
    // Обработчик на оба исхода: отклонение больше не «необработанное», результат не нужен.
    pending.then(
      () => undefined,
      () => undefined,
    );
  };
  const validate = (schema as { '~standard'?: { validate?: unknown } } | null)?.['~standard']?.validate;
  if (typeof validate !== 'function') {
    return { kind: 'threw', error: new TypeError('у схемы нет ~standard.validate (не Standard Schema)') };
  }
  let result: unknown;
  try {
    result = (validate as (input: unknown) => unknown).call(
      (schema as { '~standard': unknown })['~standard'],
      value,
    );
  } catch (error) {
    return { kind: 'threw', error };
  }
  if (thenable(result)) {
    silence(result);
    const internals = (schema as { _zod?: { run?: unknown } } | null)?._zod;
    if (typeof internals?.run !== 'function') {
      return { kind: 'async' };
    }
    try {
      const again = (internals.run as (payload: unknown, context: unknown) => unknown).call(
        internals,
        { value, issues: [] },
        { async: false },
      );
      if (thenable(again)) {
        silence(again);
      }
      return { kind: 'async' };
    } catch (error) {
      // Чтение брошенного (геттер message, constructor) само может бросить — тогда это исключение схемы, а не async.
      let asyncOnly = false;
      try {
        const message = error instanceof Error ? error.message : '';
        asyncOnly =
          (error as { constructor?: { name?: unknown } } | null)?.constructor?.name === '$ZodAsyncError' ||
          (typeof message === 'string' && /Encountered Promise during synchronous parse/.test(message));
      } catch {
        asyncOnly = false;
      }
      return asyncOnly ? { kind: 'async' } : { kind: 'threw', error };
    }
  }
  const outcome = (result ?? {}) as {
    value?: unknown;
    issues?: ReadonlyArray<{ message?: unknown; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> }>;
  };
  if (outcome.issues !== undefined) {
    return {
      kind: 'issues',
      issues: outcome.issues.map((issue) => {
        const first = issue.path?.[0];
        const head = typeof first === 'object' && first !== null ? first.key : first;
        return {
          path: issuePath(issue.path),
          message: describeThrown(issue.message ?? 'отклонено схемой'),
          ...(head === undefined ? {} : { head: describeThrown(head) }),
        };
      }),
    };
  }
  return { kind: 'value', value: outcome.value };
}
