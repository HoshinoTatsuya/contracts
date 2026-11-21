import { stableJson } from './stable-json';

/**
 * Ключ формы для сравнения «одинаковы ли»: каноническая запись без текста
 * причин непрозрачных узлов (`reason`). Причина — пояснение для человека: её
 * формулировка меняется от версии библиотеки и zod (`stringbool` в zod/v4 3.25
 * и в 4.x), а приём от этого не меняется — иначе правка текста давала бы
 * «форма изменилась, а версия та же» и ложное «не доказано».
 */
export function shapeKey(shape: unknown): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(strip);
    }
    if (typeof value !== 'object' || value === null) {
      return value;
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !(key === 'reason' && record.kind === 'opaque'))
        .map(([key, inner]) => [key, strip(inner)]),
    );
  };
  return stableJson(strip(shape));
}
