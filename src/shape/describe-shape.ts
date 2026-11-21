import type { Shape } from '../types/shape.type';

/** Короткое описание формы для текста находки: «строка», «одна из «a», «b»», «массив число». */
export function describeShape(shape: Shape, depth = 0): string {
  const quoted = (values: readonly string[]): string => {
    const shown = values.slice(0, 6).map((value) => `«${value}»`);
    return values.length > 6 ? `${shown.join(', ')} и ещё ${values.length - 6}` : shown.join(', ');
  };
  switch (shape.kind) {
    case 'string':
      return 'строка';
    case 'number':
      return shape.integer === true ? 'целое' : 'число';
    case 'boolean':
      return 'булево';
    case 'bigint':
      return 'bigint';
    case 'date':
      return 'дата';
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    case 'unknown':
      return 'что угодно';
    case 'never':
      return 'ничего';
    case 'enum':
      return shape.values.length === 1 ? `строка «${shape.values[0]}»` : `одна из ${quoted(shape.values)}`;
    case 'literal':
      return `литерал ${String(shape.value)}`;
    case 'template':
      return `строка по шаблону /${shape.pattern}/`;
    case 'object':
      return `объект {${Object.keys(shape.fields).slice(0, 6).join(', ')}${Object.keys(shape.fields).length > 6 ? ', …' : ''}}`;
    case 'record':
      return `словарь ${depth > 1 ? '…' : describeShape(shape.value, depth + 1)}`;
    case 'array':
      return `массив ${depth > 1 ? '…' : describeShape(shape.element, depth + 1)}`;
    case 'tuple':
      return `кортеж из ${shape.items.length}`;
    case 'union':
      return shape.options.map((option) => describeShape(option, depth + 1)).join(' | ');
    case 'opaque':
      return `${describeShape(shape.upper, depth)} (${shape.reason})`;
  }
}
