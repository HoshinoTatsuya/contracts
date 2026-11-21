import { shownValue } from '../runtime/shown-value';
import { canonicalShape } from '../shape/canonical-shape';
import { describeShape } from '../shape/describe-shape';
import { formatRule } from '../shape/format-rule';
import { isMultiple } from '../shape/is-multiple';
import { ownField } from '../shape/own-field';
import { regexOf } from '../shape/regex-of';
import { tupleMinimum } from '../shape/tuple-minimum';
import type { PayloadIssue } from '../types/payload-issue.type';
import type { Shape } from '../types/shape.type';

/**
 * Принимает ли форма значение — структурная проверка образца по снимку, без
 * рантайма схемы (у CLI другой стороны есть только её снимок). Шаблоны — с их
 * флагами. Формат строки проверяется выражением из записи, если zod проверяет
 * его только выражением; формат с функцией (в записи — версия zod) — нечем. Непрозрачный узел (`opaque`): значение вне `upper` — отклонение
 * наверняка; внутри — отклонения нет (что примет `transform`/`refine`, видит
 * только рантайм-разбор образцов в гейте jest). Поля — только собственные:
 * `constructor` образца — не унаследованная функция.
 */
export function validateAgainstShape(value: unknown, shape: Shape): PayloadIssue[] {
  const visit = (current: unknown, node: Shape, path: string): PayloadIssue[] => {
    const issue = (message: string): PayloadIssue[] => [{ path, message }];
    const shown = shownValue(current);
    const expected = (): PayloadIssue[] => issue(`ожидалось ${describeShape(node)}, пришло ${shown}`);
    const join = (name: string): string => (path === '' ? name : `${path}.${name}`);
    switch (node.kind) {
      case 'unknown':
        return [];
      case 'never':
        return issue('значение здесь не допускается');
      case 'opaque':
        return visit(current, node.upper, path);
      case 'string': {
        if (typeof current !== 'string') {
          return expected();
        }
        const problems: string[] = [];
        // Длина — в той единице, в какой её считает схема (zod 4.6+ — кодовые точки).
        const length = node.codePoints === true ? [...current].length : current.length;
        if (length < (node.minLength ?? 0)) {
          problems.push(`короче ${node.minLength}`);
        }
        if (length > (node.maxLength ?? Number.POSITIVE_INFINITY)) {
          problems.push(`длиннее ${node.maxLength}`);
        }
        for (const pattern of node.patterns ?? []) {
          if (!(regexOf(pattern)?.test(current) ?? false)) {
            problems.push(`не проходит ${pattern}`);
          }
        }
        // Формат, который zod проверяет только выражением, проверяется им; с функцией (версия zod) — нечем.
        for (const format of node.formats ?? []) {
          const rule = formatRule(format);
          if (rule !== undefined && !rule.test(current)) {
            problems.push(`не проходит формат ${format.split('{')[0]}`);
          }
        }
        return problems.length === 0 ? [] : issue(problems.join('; '));
      }
      case 'number': {
        if (typeof current !== 'number' || !Number.isFinite(current)) {
          return expected();
        }
        const problems: string[] = [];
        if (node.integer === true && !Number.isInteger(current)) {
          problems.push('не целое');
        }
        if (node.minimum !== undefined && current < node.minimum) {
          problems.push(`меньше ${node.minimum}`);
        }
        if (node.exclusiveMinimum !== undefined && current <= node.exclusiveMinimum) {
          problems.push(`должно быть больше ${node.exclusiveMinimum}`);
        }
        if (node.maximum !== undefined && current > node.maximum) {
          problems.push(`больше ${node.maximum}`);
        }
        if (node.exclusiveMaximum !== undefined && current >= node.exclusiveMaximum) {
          problems.push(`должно быть меньше ${node.exclusiveMaximum}`);
        }
        if (node.multipleOf !== undefined && !isMultiple(current, node.multipleOf)) {
          problems.push(`не кратно ${node.multipleOf}`);
        }
        return problems.length === 0 ? [] : issue(problems.join('; '));
      }
      case 'boolean':
        return typeof current === 'boolean' ? [] : expected();
      case 'bigint':
        return typeof current === 'bigint' ? [] : expected();
      case 'date':
        // По JSON дата едет строкой; z.date() строку не принимает.
        return current instanceof Date ? [] : expected();
      case 'null':
        return current === null ? [] : expected();
      case 'undefined':
        return current === undefined ? [] : expected();
      case 'enum':
        return typeof current === 'string' && node.values.includes(current) ? [] : expected();
      case 'literal':
        return current === node.value ? [] : expected();
      case 'template': {
        let accepted = false;
        try {
          accepted = typeof current === 'string' && new RegExp(node.pattern).test(current);
        } catch {
          accepted = false;
        }
        return accepted ? [] : expected();
      }
      case 'object': {
        if (typeof current !== 'object' || current === null || Array.isArray(current)) {
          return expected();
        }
        const record = current as Record<string, unknown>;
        const own = (name: string): unknown => (Object.hasOwn(record, name) ? record[name] : undefined);
        const issues: PayloadIssue[] = [];
        for (const [name, field] of Object.entries(node.fields)) {
          const inner = own(name);
          if (inner === undefined) {
            if (!field.optional) {
              issues.push({ path: join(name), message: 'нет обязательного поля' });
            }
          } else {
            issues.push(...visit(inner, field.shape, join(name)));
          }
        }
        for (const name of Object.keys(record)) {
          if (ownField(node.fields, name) !== undefined || record[name] === undefined) {
            continue;
          }
          if (node.unknownKeys === 'reject') {
            issues.push({ path: join(name), message: 'поле, которого строгий объект не знает' });
          } else if (node.unknownKeys === 'keep') {
            issues.push(...visit(record[name], node.rest ?? { kind: 'unknown' }, join(name)));
          }
        }
        return issues;
      }
      case 'record': {
        if (typeof current !== 'object' || current === null || Array.isArray(current)) {
          return expected();
        }
        return Object.entries(current as Record<string, unknown>).flatMap(([name, inner]) => [
          ...visit(name, node.key, `${join(name)}{key}`),
          ...visit(inner, node.value, join(name)),
        ]);
      }
      case 'array': {
        if (!Array.isArray(current)) {
          return expected();
        }
        const issues: PayloadIssue[] = [];
        if (
          current.length < (node.minItems ?? 0) ||
          current.length > (node.maxItems ?? Number.POSITIVE_INFINITY)
        ) {
          issues.push({
            path,
            message: `элементов ${current.length}, допустимо [${node.minItems ?? 0}, ${node.maxItems ?? '∞'}]`,
          });
        }
        current.forEach((inner, index) => {
          issues.push(...visit(inner, node.element, `${path}[${index}]`));
        });
        return issues;
      }
      case 'tuple': {
        if (!Array.isArray(current)) {
          return expected();
        }
        const issues: PayloadIssue[] = [];
        if (current.length > node.items.length && node.rest === undefined) {
          issues.push({ path, message: `элементов ${current.length}, кортеж из ${node.items.length}` });
        }
        current.forEach((inner, index) => {
          const own = node.items[index] ?? node.rest;
          if (own !== undefined) {
            issues.push(...visit(inner, own, `${path}[${index}]`));
          }
        });
        const required = tupleMinimum(node);
        if (current.length < required) {
          issues.push({ path, message: `элементов ${current.length}, кортеж требует не меньше ${required}` });
        }
        return issues;
      }
      case 'union': {
        const tried = node.options.map((option) => visit(current, option, path));
        if (tried.some((issues) => issues.length === 0)) {
          return [];
        }
        const sameKind = node.options
          .map((option, index) => ({ option, issues: tried[index] as PayloadIssue[] }))
          .filter(({ option }) => option.kind === 'object' && typeof current === 'object' && current !== null)
          .sort((a, b) => a.issues.length - b.issues.length);
        return sameKind[0]?.issues ?? expected();
      }
    }
  };
  return visit(value, canonicalShape(shape), '');
}
