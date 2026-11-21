/**
 * Шаблон строки в снимке — литерал `/источник/флаги`: флаги (`i`, `m`, `s`,
 * `u`, `v`, `y`) меняют, что шаблон принимает, и без них `/^a$/i` и `/^a$/`
 * были бы одной записью. `g` и `d` на результат `test` с нулевого
 * `lastIndex` не влияют и в запись не попадают; порядок флагов — алфавитный.
 */
export function patternLiteral(source: string, flags: string): string {
  return `/${source}/${[...flags]
    .filter((flag) => flag !== 'g' && flag !== 'd')
    .sort()
    .join('')}`;
}
