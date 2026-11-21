import { validateAgainstShape } from '../compare/validate-against-shape';
import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { ContractPayloadError } from '../errors/contract-payload.error';
import { canonicalShape } from '../shape/canonical-shape';
import { ownField } from '../shape/own-field';
import { setOwn } from '../shape/set-own';
import type { Shape } from '../types/shape.type';
import { fieldsOutsideShape } from './fields-outside-shape';
import { isPlainObject } from './is-plain-object';
import { mergeUnknownFields } from './merge-unknown-fields';

/**
 * Выход разбора, в который возвращены поля входа ВНЕ ФОРМЫ контракта
 * (`unknownFields: 'keep'`). Поле, которое форма объявляет, не возвращается,
 * даже если выхода у него нет: его прочитал и переименовал или убрал
 * `transform` — вернуть его значило бы положить в результат то, что схема
 * сознательно преобразовала (`{ b: 1, a: 1 }` вместо `{ b: 1 }`).
 *
 * Там, где форма о полях не говорит (непрозрачный узел с границей «что
 * угодно»), — прежнее сопоставление входа с выходом (`mergeUnknownFields`).
 * Поля пишутся собственными свойствами: присланный `__proto__` остаётся полем.
 */
export function mergeOutsideFields(
  output: unknown,
  input: unknown,
  shape: Shape,
  contract = 'контракт',
): unknown {
  const visit = (out: unknown, inp: unknown, node: Shape, depth: number): unknown => {
    if (out === inp) {
      return out;
    }
    if (depth > CONTRACT_FORMAT.MAX_SHAPE_DEPTH) {
      throw new ContractPayloadError(contract, [
        { path: '', message: `вложенность глубже ${CONTRACT_FORMAT.MAX_SHAPE_DEPTH} уровней` },
      ]);
    }
    switch (node.kind) {
      case 'opaque':
        return node.upper.kind === 'unknown'
          ? mergeUnknownFields(out, inp, contract, depth)
          : visit(out, inp, node.upper, depth + 1);
      case 'union': {
        const accepting = node.options.filter((option) => validateAgainstShape(inp, option).length === 0);
        const ranked = accepting
          .map((option) => ({ option, found: fieldsOutsideShape(inp, option) }))
          .sort(
            (a, b) =>
              a.found.outside.length +
              a.found.undetermined.length * 1000 -
              (b.found.outside.length + b.found.undetermined.length * 1000),
          );
        const [best] = ranked;
        return best === undefined
          ? mergeUnknownFields(out, inp, contract, depth)
          : visit(out, inp, best.option, depth + 1);
      }
      case 'object': {
        if (!isPlainObject(out) || !isPlainObject(inp)) {
          return out;
        }
        const merged: Record<string, unknown> = {};
        for (const key of Object.keys(out)) {
          setOwn(merged, key, out[key]);
        }
        for (const key of Object.keys(inp)) {
          const field = ownField(node.fields, key);
          if (field !== undefined) {
            if (Object.hasOwn(out, key)) {
              setOwn(merged, key, visit(out[key], inp[key], field.shape, depth + 1));
            }
          } else if (Object.hasOwn(out, key)) {
            setOwn(merged, key, visit(out[key], inp[key], node.rest ?? { kind: 'unknown' }, depth + 1));
          } else if (node.unknownKeys !== 'keep') {
            setOwn(merged, key, inp[key]);
          }
        }
        return merged;
      }
      case 'record': {
        if (!isPlainObject(out) || !isPlainObject(inp)) {
          return out;
        }
        const merged: Record<string, unknown> = {};
        for (const key of Object.keys(out)) {
          setOwn(
            merged,
            key,
            Object.hasOwn(inp, key) ? visit(out[key], inp[key], node.value, depth + 1) : out[key],
          );
        }
        return merged;
      }
      case 'array':
        return Array.isArray(out) && Array.isArray(inp) && out.length === inp.length
          ? out.map((item, at) => visit(item, inp[at], node.element, depth + 1))
          : out;
      case 'tuple':
        return Array.isArray(out) && Array.isArray(inp) && out.length === inp.length
          ? out.map((item, at) => {
              const own = node.items[at] ?? node.rest;
              return own === undefined ? item : visit(item, inp[at], own, depth + 1);
            })
          : out;
      default:
        return out;
    }
  };
  return visit(output, input, canonicalShape(shape), 0);
}
