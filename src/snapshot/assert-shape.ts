import { SnapshotFormatError } from '../errors/snapshot-format.error';
import { regexOf } from '../shape/regex-of';
import type { Shape } from '../types/shape.type';

/**
 * Форма из чужого документа — структурно та, которую понимает сверка.
 * Неизвестный вид И неизвестный ключ узла — отказ: сверка, пропустившая то,
 * чего не понимает (`exclusive` у объединения, флаги рядом с шаблоном),
 * отвечала бы «совместимо» про непроверенное. Шаблон строки — литерал
 * `/…/флаги`, который компилируется: иначе сверка упала бы посреди отчёта.
 */
export function assertShape(value: unknown, source: string, path: string): asserts value is Shape {
  const keys: Readonly<Record<string, readonly string[]>> = {
    string: ['minLength', 'maxLength', 'patterns', 'formats', 'codePoints'],
    number: ['integer', 'minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum', 'multipleOf'],
    boolean: [],
    bigint: [],
    date: [],
    null: [],
    undefined: [],
    unknown: [],
    never: [],
    enum: ['values'],
    literal: ['value'],
    template: ['pattern'],
    object: ['fields', 'unknownKeys', 'rest'],
    record: ['key', 'value'],
    array: ['element', 'minItems', 'maxItems'],
    tuple: ['items', 'rest', 'minItems'],
    union: ['options'],
    opaque: ['reason', 'upper', 'lower', 'exact', 'semantics'],
  };
  const fail = (detail: string): never => {
    throw new SnapshotFormatError(source, `${path || '(корень)'}: ${detail}`);
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('форма — не объект');
  }
  const node = value as Record<string, unknown>;
  const allowed =
    typeof node.kind === 'string' && Object.hasOwn(keys, node.kind) ? keys[node.kind] : undefined;
  if (allowed === undefined) {
    return fail(`неизвестный вид формы ${JSON.stringify(node.kind)}`);
  }
  const extra = Object.keys(node).filter((key) => key !== 'kind' && !allowed.includes(key));
  if (extra.length > 0) {
    fail(`незнакомые ключи узла «${String(node.kind)}»: ${extra.join(', ')}`);
  }
  const numbers = (names: readonly string[]): void => {
    for (const name of names) {
      if (node[name] !== undefined && (typeof node[name] !== 'number' || Number.isNaN(node[name]))) {
        fail(`${name} — не число`);
      }
    }
  };
  const strings = (name: string): readonly string[] => {
    const list = node[name];
    if (list === undefined) {
      return [];
    }
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
      return fail(`${name} — не список строк`);
    }
    return list as string[];
  };
  switch (node.kind) {
    case 'string':
      numbers(['minLength', 'maxLength']);
      for (const pattern of strings('patterns')) {
        if (regexOf(pattern) === null) {
          fail(`шаблон ${JSON.stringify(pattern)} — не литерал /…/флаги или не компилируется`);
        }
      }
      strings('formats');
      if (node.codePoints !== undefined && node.codePoints !== true) {
        fail('codePoints — не true');
      }
      break;
    case 'number':
      numbers(['minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum', 'multipleOf']);
      if (node.integer !== undefined && node.integer !== true) {
        fail('integer — не true');
      }
      break;
    case 'enum':
      if (!Array.isArray(node.values) || node.values.some((item) => typeof item !== 'string')) {
        fail('enum без списка строк');
      }
      if (new Set(node.values as string[]).size !== (node.values as string[]).length) {
        fail('enum с повторами строк');
      }
      break;
    case 'literal':
      if (typeof node.value !== 'number' && typeof node.value !== 'boolean') {
        fail('литерал не число и не булево');
      }
      break;
    case 'template':
      if (typeof node.pattern !== 'string') {
        fail('шаблон без pattern');
      }
      try {
        new RegExp(node.pattern as string);
      } catch {
        fail(`шаблон ${JSON.stringify(node.pattern)} не компилируется`);
      }
      break;
    case 'object': {
      if (typeof node.fields !== 'object' || node.fields === null || Array.isArray(node.fields)) {
        fail('объект без fields');
      }
      if (node.unknownKeys !== 'strip' && node.unknownKeys !== 'reject' && node.unknownKeys !== 'keep') {
        fail(`неизвестная политика лишних полей ${JSON.stringify(node.unknownKeys)}`);
      }
      for (const [name, field] of Object.entries(node.fields as Record<string, unknown>)) {
        const entry = field as { optional?: unknown; undefinedAccepted?: unknown; shape?: unknown } | null;
        if (typeof entry !== 'object' || entry === null || typeof entry.optional !== 'boolean') {
          fail(`поле ${name} без optional`);
        }
        if ((entry as { undefinedAccepted?: unknown }).undefinedAccepted !== undefined) {
          if (
            (entry as { undefinedAccepted?: unknown }).undefinedAccepted !== true ||
            (entry as { optional: boolean }).optional
          ) {
            fail(`поле ${name}: undefinedAccepted — только true и только у обязательного поля`);
          }
        }
        const fieldKeys = Object.keys(entry as object).filter(
          (key) => key !== 'optional' && key !== 'shape' && key !== 'undefinedAccepted',
        );
        if (fieldKeys.length > 0) {
          fail(`поле ${name}: незнакомые ключи ${fieldKeys.join(', ')}`);
        }
        assertShape((entry as { shape?: unknown }).shape, source, path === '' ? name : `${path}.${name}`);
      }
      if (node.rest !== undefined) {
        if (node.unknownKeys !== 'keep') {
          fail(`rest у объекта с политикой ${String(node.unknownKeys)}: лишние поля он не сохраняет`);
        }
        assertShape(node.rest, source, `${path}{*}`);
      }
      break;
    }
    case 'record':
      assertShape(node.key, source, `${path}{key}`);
      if (
        !['string', 'enum', 'template', 'number', 'union', 'opaque'].includes(
          (node.key as { kind: string }).kind,
        )
      ) {
        fail(`ключ словаря вида «${(node.key as { kind: string }).kind}»: ключ JSON — строка`);
      }
      assertShape(node.value, source, `${path}{*}`);
      break;
    case 'array':
      numbers(['minItems', 'maxItems']);
      assertShape(node.element, source, `${path}[]`);
      break;
    case 'tuple':
      if (!Array.isArray(node.items)) {
        fail('кортеж без items');
      }
      numbers(['minItems']);
      (node.items as unknown[]).forEach((item, index) => {
        assertShape(item, source, `${path}[${index}]`);
      });
      if (node.rest !== undefined) {
        assertShape(node.rest, source, `${path}[...]`);
      }
      break;
    case 'union':
      if (!Array.isArray(node.options)) {
        fail('объединение без options');
      }
      (node.options as unknown[]).forEach((option, index) => {
        assertShape(option, source, `${path}|${index}`);
      });
      break;
    case 'opaque':
      if (typeof node.reason !== 'string' || node.reason === '') {
        fail('непрозрачный узел без reason');
      }
      assertShape(node.upper, source, path);
      if (node.lower !== undefined) {
        assertShape(node.lower, source, path);
      }
      if (node.exact !== undefined && (node.exact !== true || node.lower !== undefined)) {
        fail('exact — только true и без lower (приём ровно как у upper)');
      }
      if (node.semantics !== undefined && (typeof node.semantics !== 'string' || node.semantics === '')) {
        fail('semantics — не строка');
      }
      break;
    default:
      break;
  }
}
