/**
 * Кратно ли число шагу — без ошибки двоичной дроби: `0.3 % 0.1` в IEEE 754 —
 * не ноль, хотя 0.3 кратно 0.1. Частное сравнивается с ближайшим целым с
 * допуском в несколько ulp.
 */
export function isMultiple(value: number, step: number): boolean {
  if (step === 0 || !Number.isFinite(value) || !Number.isFinite(step)) {
    return false;
  }
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) <= Number.EPSILON * 8 * Math.max(1, Math.abs(ratio));
}
