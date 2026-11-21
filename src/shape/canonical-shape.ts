import type { FieldShape } from '../types/field-shape.type';
import type { Shape } from '../types/shape.type';
import { determined } from './determined';
import { setOwn } from './set-own';
import { shapeKey } from './shape-key';
import { stableJson } from './stable-json';
import { tupleMinimum } from './tuple-minimum';

/**
 * Каноническая форма: одно и то же значение на проводе — одна запись, как бы
 * его ни описали. Объединения уплощаются, повторы и `never` убираются,
 * строковые литералы сливаются в один `enum`, `true | false` — в `boolean`,
 * литерал поглощается простым типом того же вида, наборы строк сортируются.
 */
export function canonicalShape(shape: Shape): Shape {
  const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

  const isPlain = (shape: Shape): boolean => {
    if (shape.kind === 'string') {
      return (
        shape.minLength === undefined &&
        shape.maxLength === undefined &&
        (shape.patterns ?? []).length === 0 &&
        (shape.formats ?? []).length === 0
      );
    }
    if (shape.kind === 'number') {
      return Object.keys(shape).length === 1;
    }
    return false;
  };

  const canonicalUnion = (options: readonly Shape[]): Shape => {
    const flat: Shape[] = [];
    for (const option of options.map(canonicalShape)) {
      if (option.kind === 'union') {
        flat.push(...option.options);
      } else if (option.kind !== 'never') {
        flat.push(option);
      }
    }
    if (flat.some((option) => option.kind === 'unknown')) {
      // «Что угодно» поглощает варианты по ПРИЁМУ. Но вариант-объект (массив, словарь, непрозрачный узел)
      // меняет выход — выбрасывает поля, если zod выберет его первым: зеркалу это различие видно.
      const shaping = flat.filter((option) =>
        ['object', 'record', 'array', 'tuple', 'union', 'opaque'].includes(option.kind),
      );
      // `undefined` остаётся отдельным вариантом: член кортежа `unknown().optional()` может отсутствовать, `unknown()` — нет.
      const absent = flat.some((option) => option.kind === 'undefined');
      const accepted: Shape = absent
        ? { kind: 'union', options: [{ kind: 'undefined' }, { kind: 'unknown' }] }
        : { kind: 'unknown' };
      if (shaping.length === 0) {
        return accepted;
      }
      const options = [...new Map(shaping.map((option) => [shapeKey(option), option])).entries()]
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([, option]) => option);
      return {
        kind: 'opaque',
        reason: 'объединение с «что угодно»: варианты меняют только выход',
        upper: accepted,
        exact: true,
        ...(options.every(determined) ? { semantics: `варианты ${shapeKey(options)}` } : {}),
      };
    }
    const plainString = flat.some((option) => option.kind === 'string' && isPlain(option));
    const plainNumber = flat.some((option) => option.kind === 'number' && isPlain(option));
    const values = new Set<string>();
    const booleans = new Set<boolean>();
    const rest: Shape[] = [];
    for (const option of flat) {
      if (option.kind === 'enum') {
        if (!plainString) {
          for (const value of option.values) {
            values.add(value);
          }
        }
      } else if (option.kind === 'template' && plainString) {
        // Шаблон строки поглощается простой строкой.
      } else if (option.kind === 'literal' && typeof option.value === 'boolean') {
        booleans.add(option.value);
      } else if (option.kind === 'literal' && plainNumber) {
        // Числовой литерал поглощается простым числом.
      } else {
        rest.push(option);
      }
    }
    const hasBoolean = rest.some((option) => option.kind === 'boolean');
    if (!hasBoolean && booleans.size === 2) {
      rest.push({ kind: 'boolean' });
    } else if (!hasBoolean) {
      for (const value of booleans) {
        rest.push({ kind: 'literal', value });
      }
    }
    if (values.size > 0) {
      rest.push({ kind: 'enum', values: sortedUnique([...values]) });
    }
    const unique = new Map(rest.map((option) => [stableJson(option), option]));
    const sorted = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, option]) => option);
    if (sorted.length === 0) {
      return { kind: 'never' };
    }
    return sorted.length === 1 ? (sorted[0] as Shape) : { kind: 'union', options: sorted };
  };

  switch (shape.kind) {
    case 'string': {
      const patterns = sortedUnique(shape.patterns ?? []);
      const formats = sortedUnique(shape.formats ?? []);
      if ((shape.minLength ?? 0) > (shape.maxLength ?? Number.POSITIVE_INFINITY)) {
        return { kind: 'never' };
      }
      return {
        kind: 'string',
        ...(shape.minLength === undefined || shape.minLength === 0 ? {} : { minLength: shape.minLength }),
        ...(shape.maxLength === undefined ? {} : { maxLength: shape.maxLength }),
        ...(patterns.length === 0 ? {} : { patterns }),
        ...(formats.length === 0 ? {} : { formats }),
        ...(shape.codePoints === true &&
        ((shape.minLength !== undefined && shape.minLength > 0) || shape.maxLength !== undefined)
          ? { codePoints: true as const }
          : {}),
      };
    }
    case 'enum':
      return shape.values.length === 0
        ? { kind: 'never' }
        : { kind: 'enum', values: sortedUnique(shape.values) };
    case 'union':
      return canonicalUnion(shape.options);
    case 'object': {
      const fields: Record<string, FieldShape> = {};
      for (const name of Object.keys(shape.fields).sort()) {
        const field = shape.fields[name] as FieldShape;
        setOwn(fields, name, {
          optional: field.optional,
          ...(!field.optional && field.undefinedAccepted === true
            ? { undefinedAccepted: true as const }
            : {}),
          shape: canonicalShape(field.shape),
        });
      }
      return shape.unknownKeys === 'keep'
        ? {
            kind: 'object',
            fields,
            unknownKeys: 'keep',
            rest: canonicalShape(shape.rest ?? { kind: 'unknown' }),
          }
        : { kind: 'object', fields, unknownKeys: shape.unknownKeys };
    }
    case 'record':
      return { kind: 'record', key: canonicalShape(shape.key), value: canonicalShape(shape.value) };
    case 'array':
      if ((shape.minItems ?? 0) > (shape.maxItems ?? Number.POSITIVE_INFINITY)) {
        return { kind: 'never' };
      }
      return {
        kind: 'array',
        element: canonicalShape(shape.element),
        ...(shape.minItems === undefined || shape.minItems === 0 ? {} : { minItems: shape.minItems }),
        ...(shape.maxItems === undefined ? {} : { maxItems: shape.maxItems }),
      };
    case 'number': {
      // Из двух нижних (верхних) границ остаётся более строгая; пустой диапазон — `never`.
      // Бесконечная граница — не граница (и в JSON снимка её не записать).
      const finite = (value: number | undefined): number | undefined =>
        value !== undefined && Number.isFinite(value) ? value : undefined;
      const minimum = finite(shape.minimum);
      const exclusiveMinimum = finite(shape.exclusiveMinimum);
      const maximum = finite(shape.maximum);
      const exclusiveMaximum = finite(shape.exclusiveMaximum);
      const lowExclusive =
        exclusiveMinimum !== undefined && (minimum === undefined || exclusiveMinimum >= minimum);
      const low = lowExclusive ? exclusiveMinimum : minimum;
      const highExclusive =
        exclusiveMaximum !== undefined && (maximum === undefined || exclusiveMaximum <= maximum);
      const high = highExclusive ? exclusiveMaximum : maximum;
      if (
        low !== undefined &&
        high !== undefined &&
        (low > high || (low === high && (lowExclusive || highExclusive)))
      ) {
        return { kind: 'never' };
      }
      return {
        kind: 'number',
        ...(shape.integer === true ? { integer: true } : {}),
        ...(low === undefined ? {} : lowExclusive ? { exclusiveMinimum: low } : { minimum: low }),
        ...(high === undefined ? {} : highExclusive ? { exclusiveMaximum: high } : { maximum: high }),
        ...(shape.multipleOf === undefined ? {} : { multipleOf: shape.multipleOf }),
      };
    }
    case 'tuple': {
      const items = shape.items.map(canonicalShape);
      const bare = {
        kind: 'tuple' as const,
        items,
        ...(shape.rest === undefined ? {} : { rest: canonicalShape(shape.rest) }),
      };
      // Требуемая длина пишется, только если её не выводят необязательные последние члены.
      return shape.minItems === undefined || shape.minItems === tupleMinimum(bare)
        ? bare
        : { ...bare, minItems: shape.minItems };
    }
    case 'opaque': {
      const upper = canonicalShape(shape.upper);
      if (shape.exact === true) {
        // Меняет только выход: приём точный, узел остаётся — зеркалу важно, что выход другой.
        return {
          kind: 'opaque',
          reason: shape.reason,
          upper,
          exact: true,
          ...(shape.semantics === undefined ? {} : { semantics: shape.semantics }),
        };
      }
      // Непрозрачный узел, у которого «принято наверняка» совпало с «принято вообще», — точная форма.
      const lower = shape.lower === undefined ? undefined : canonicalShape(shape.lower);
      if (lower !== undefined && shape.semantics === undefined && stableJson(lower) === stableJson(upper)) {
        return upper;
      }
      return {
        kind: 'opaque',
        reason: shape.reason,
        upper,
        ...(lower === undefined || lower.kind === 'never' ? {} : { lower }),
        ...(shape.semantics === undefined ? {} : { semantics: shape.semantics }),
      };
    }
    default:
      return shape;
  }
}
