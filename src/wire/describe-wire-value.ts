import type { WireValue } from '../types/wire-value.type';

/** Значение на проводе для текста находки: `"scan-tasks"`, `90000`, `` `lock:${0}` `` (1 арг.). */
export function describeWireValue(value: WireValue): string {
  switch (value.type) {
    case 'string':
      return JSON.stringify(value.value);
    case 'number':
    case 'boolean':
      return String(value.value);
    case 'null':
      return 'null';
    case 'template':
      return `\`${value.value}\` (${value.arity} арг.)`;
  }
}
