import type { Shape } from '../types/shape.type';

/**
 * Доказуемо ли, что никакое значение не подходит под два варианта сразу.
 * Нужно для `z.xor`: исключающее объединение отвергает значение, подошедшее
 * под несколько вариантов, и равно обычному объединению, только если варианты
 * не пересекаются. «Не смог доказать» — `false`.
 *
 * Различают: вид значения (строка, число, булево, null, объект, массив),
 * непересекающиеся наборы строк и литералы, объекты с обязательным полем-меткой
 * с разными единственными значениями.
 */
export function optionsDisjoint(options: readonly Shape[]): boolean {
  const family = (shape: Shape): string | null => {
    switch (shape.kind) {
      case 'string':
      case 'enum':
      case 'template':
        return 'string';
      case 'number':
        return 'number';
      case 'literal':
        return typeof shape.value;
      case 'boolean':
        return 'boolean';
      case 'object':
      case 'record':
        return 'object';
      case 'array':
      case 'tuple':
        return 'array';
      case 'null':
      case 'undefined':
      case 'bigint':
      case 'date':
        return shape.kind;
      default:
        return null;
    }
  };
  const tag = (shape: Shape, name: string): string | number | boolean | undefined => {
    if (shape.kind !== 'object' || !Object.hasOwn(shape.fields, name)) {
      return undefined;
    }
    const field = shape.fields[name];
    if (field === undefined || field.optional) {
      return undefined;
    }
    if (field.shape.kind === 'enum' && field.shape.values.length === 1) {
      return field.shape.values[0];
    }
    return field.shape.kind === 'literal' ? field.shape.value : undefined;
  };
  const pair = (a: Shape, b: Shape): boolean => {
    const left = family(a);
    const right = family(b);
    if (left === null || right === null) {
      return false;
    }
    if (left !== right) {
      return true;
    }
    if (a.kind === 'enum' && b.kind === 'enum') {
      return a.values.every((value) => !b.values.includes(value));
    }
    if (a.kind === 'literal' && b.kind === 'literal') {
      return a.value !== b.value;
    }
    if (a.kind === 'object' && b.kind === 'object') {
      return Object.keys(a.fields).some((name) => {
        const mine = tag(a, name);
        const theirs = tag(b, name);
        return mine !== undefined && theirs !== undefined && mine !== theirs;
      });
    }
    return false;
  };
  return options.every((a, index) => options.slice(index + 1).every((b) => pair(a, b)));
}
