/**
 * Чего нет у объекта компилятора: имя — в объекте или его прототипе (у TS 7
 * методы бывают геттерами прототипа), значение нужного вида. Отказ называет
 * каждое недостающее имя с владельцем — `Checker.getTypeAtLocation`, а не
 * «что-то не так».
 */
export function missingMembers(
  owner: unknown,
  label: string,
  names: readonly string[],
  kind: 'function' | 'number' | 'object' | 'present',
): string[] {
  const holder =
    (typeof owner === 'object' || typeof owner === 'function') && owner !== null ? owner : undefined;
  return names
    .filter((name) => {
      if (holder === undefined || !(name in holder)) {
        return true;
      }
      if (kind === 'present') {
        return false;
      }
      const value: unknown = (holder as Record<string, unknown>)[name];
      return kind === 'object' ? typeof value !== 'object' || value === null : typeof value !== kind;
    })
    .map((name) => `${label}.${name}`);
}
