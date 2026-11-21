import type { EngineType } from '../../types/engine-type.type';
import type { TypeView } from '../../types/type-view.type';
import type { TYPE_SCRIPT_API } from './type-script-api.constant';

/**
 * Вид типа по флагам — общий для всех адаптеров, чтобы порядок проверок не
 * разошёлся между компиляторами: ошибка компилятора раньше `any`, литерал
 * раньше примитива (`true` несёт и `Boolean`-подобные флаги), `boolean` раньше
 * объединения (это объединение `true | false`). Числа флагов — из
 * установленного компилятора, доступ к значениям — через адаптер.
 */
export function viewOfType<T>(
  type: T,
  flags: number,
  table: Readonly<Record<(typeof TYPE_SCRIPT_API)['typeFlags'][number], number>>,
  access: {
    readonly isError: (type: T) => boolean;
    readonly literal: (type: T) => string | number | boolean | undefined;
    readonly members: (type: T) => readonly T[];
    readonly texts: (type: T) => readonly string[];
  },
): TypeView {
  const has = (...names: ReadonlyArray<keyof typeof table>): boolean =>
    names.some((name) => (flags & table[name]) !== 0);
  const engine = (types: readonly T[]): readonly EngineType[] => types as unknown as readonly EngineType[];
  if (has('Any')) {
    return { kind: access.isError(type) ? 'error' : 'any' };
  }
  if (has('Unknown')) {
    return { kind: 'unknown' };
  }
  if (has('Never')) {
    return { kind: 'never' };
  }
  if (has('Undefined', 'Void')) {
    return { kind: 'undefined' };
  }
  if (has('Null')) {
    return { kind: 'null' };
  }
  if (has('StringLiteral')) {
    return { kind: 'string-literal', value: String(access.literal(type)) };
  }
  if (has('NumberLiteral')) {
    return { kind: 'number-literal', value: Number(access.literal(type)) };
  }
  if (has('BooleanLiteral')) {
    return { kind: 'boolean-literal', value: access.literal(type) === true };
  }
  if (has('BigInt', 'BigIntLiteral')) {
    return { kind: 'bigint' };
  }
  if (has('Boolean')) {
    return { kind: 'boolean' };
  }
  if (has('String')) {
    return { kind: 'string' };
  }
  if (has('Number')) {
    return { kind: 'number' };
  }
  if (has('TemplateLiteral')) {
    return { kind: 'template', texts: access.texts(type), parts: engine(access.members(type)) };
  }
  if (has('NonPrimitive')) {
    return { kind: 'non-primitive' };
  }
  if (has('TypeParameter', 'ESSymbolLike', 'Index')) {
    return { kind: 'unshaped' };
  }
  if (has('Union')) {
    return { kind: 'union', members: engine(access.members(type)) };
  }
  if (has('Intersection')) {
    return { kind: 'intersection', members: engine(access.members(type)) };
  }
  return { kind: has('Object') ? 'object' : 'other' };
}
