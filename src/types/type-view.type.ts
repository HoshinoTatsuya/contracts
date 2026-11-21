import type { EngineType } from './engine-type.type';

/**
 * Вид типа, одинаковый у всех компиляторов: порядок проверок в адаптере
 * повторяет порядок разбора формы (ошибка компилятора раньше `any`, литерал
 * раньше примитива, примитив раньше объединения).
 */
export type TypeView =
  | {
      readonly kind:
        | 'error'
        | 'any'
        | 'unknown'
        | 'never'
        | 'undefined'
        | 'null'
        | 'bigint'
        | 'boolean'
        | 'string'
        | 'number'
        | 'non-primitive'
        | 'unshaped'
        | 'object'
        | 'other';
    }
  | { readonly kind: 'string-literal'; readonly value: string }
  | { readonly kind: 'number-literal'; readonly value: number }
  | { readonly kind: 'boolean-literal'; readonly value: boolean }
  | { readonly kind: 'template'; readonly texts: readonly string[]; readonly parts: readonly EngineType[] }
  | { readonly kind: 'union' | 'intersection'; readonly members: readonly EngineType[] };
