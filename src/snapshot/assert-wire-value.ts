/**
 * Значение на проводе из чужого снимка: вид и ровно его поля. Незнакомое поле
 * или значение не того типа — отказ: сверка сравнила бы то, чего не понимает.
 */
export function assertWireValue(value: unknown, fail: (detail: string) => never): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('не объект');
  }
  const node = value as Record<string, unknown>;
  const fields: Readonly<Record<string, readonly string[]>> = {
    string: ['type', 'value'],
    number: ['type', 'value'],
    boolean: ['type', 'value'],
    null: ['type'],
    template: ['type', 'arity', 'value'],
  };
  const allowed =
    typeof node.type === 'string' && Object.hasOwn(fields, node.type) ? fields[node.type] : undefined;
  if (allowed === undefined) {
    fail(`неизвестный тип ${JSON.stringify(node.type)}`);
    return;
  }
  const extra = Object.keys(node).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    fail(`незнакомые поля ${extra.join(', ')}`);
  }
  const valid =
    node.type === 'null' ||
    (node.type === 'string' && typeof node.value === 'string') ||
    (node.type === 'number' && typeof node.value === 'number' && Number.isFinite(node.value)) ||
    (node.type === 'boolean' && typeof node.value === 'boolean') ||
    (node.type === 'template' &&
      typeof node.value === 'string' &&
      typeof node.arity === 'number' &&
      Number.isInteger(node.arity) &&
      node.arity >= 0);
  if (!valid) {
    fail(`значение не того вида для типа ${String(node.type)}`);
  }
}
