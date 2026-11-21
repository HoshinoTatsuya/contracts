import type { FieldShape } from '../types/field-shape.type';

/**
 * Поле формы по имени — только СОБСТВЕННОЕ. `fields[name]` и `name in fields`
 * видят прототип: поле `constructor` или `toString` нашлось бы у формы, где
 * его нет, — с ложным «совместимо» или `TypeError` посреди сверки.
 */
export function ownField(fields: Readonly<Record<string, FieldShape>>, name: string): FieldShape | undefined {
  return Object.hasOwn(fields, name) ? fields[name] : undefined;
}
