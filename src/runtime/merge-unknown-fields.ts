import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { ContractPayloadError } from '../errors/contract-payload.error';
import { setOwn } from '../shape/set-own';
import { isPlainObject } from './is-plain-object';

/**
 * Выход разбора, в который возвращены поля входа, выброшенные схемой.
 *
 * Поля пишутся собственными свойствами (`setOwn`): ключ `__proto__` из
 * payload (`JSON.parse` делает его обычным полем) остаётся полем и не
 * становится прототипом результата — иначе `data.isAdmin` читался бы из
 * присланного прототипа. Значение, которое схема пропустила тем же объектом,
 * не обходится: глубина обхода ограничена схемой, а не payload; глубже
 * `CONTRACT_FORMAT.MAX_SHAPE_DEPTH` — `ContractPayloadError`, а не
 * переполнение стека.
 */
export function mergeUnknownFields(
  output: unknown,
  input: unknown,
  contract = 'контракт',
  depth = 0,
): unknown {
  if (output === input) {
    return output;
  }
  if (depth > CONTRACT_FORMAT.MAX_SHAPE_DEPTH) {
    throw new ContractPayloadError(contract, [
      { path: '', message: `вложенность глубже ${CONTRACT_FORMAT.MAX_SHAPE_DEPTH} уровней` },
    ]);
  }
  if (isPlainObject(input) && isPlainObject(output)) {
    // Спред копирует собственные поля без сеттера прототипа; `__proto__` — единственный ключ,
    // присваивание которого меняет прототип, поэтому только он пишется через `setOwn` (быстрее на больших payload).
    const merged: Record<string, unknown> = { ...output };
    for (const key of Object.keys(input)) {
      const value = Object.hasOwn(output, key)
        ? mergeUnknownFields(output[key], input[key], contract, depth + 1)
        : input[key];
      if (key === '__proto__') {
        setOwn(merged, key, value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }
  if (Array.isArray(input) && Array.isArray(output) && input.length === output.length) {
    return output.map((item, index) => mergeUnknownFields(item, input[index], contract, depth + 1));
  }
  return output;
}
