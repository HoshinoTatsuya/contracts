import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Декларации, которые видит потребитель (от входов карты exports по
 * относительным импортам), не ссылаются на пакет `typescript`: у TS 7 его
 * вход — только версия, и `ts.Program`/`ts.Node` в декларациях дали бы TS2694
 * при `skipLibCheck: false`. Внутренние модули адаптера описывают узлы
 * типами 5.9 — их декларации потребителю недостижимы, и это проверяется
 * здесь же, обходом, а не списком файлов.
 *
 * Нужен собранный `dist` (`pnpm test` собирает его первым).
 */
const ROOT = join(__dirname, '..', '..');
const ENTRIES = ['dist/index.d.ts', 'dist/typescript/index.d.ts', 'dist/jest/index.d.ts'];
const SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|<reference\s+(?:path|types)=)["']([^"']+)["']/g;

const reachable = (): Map<string, string[]> => {
  const seen = new Map<string, string[]>();
  const queue = ENTRIES.map((entry) => join(ROOT, entry));
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const specifiers = [...text.matchAll(SPECIFIER)].map((match) => match[1] ?? '');
    seen.set(file, specifiers);
    for (const specifier of specifiers.filter((value) => value.startsWith('.'))) {
      const base = resolve(dirname(file), specifier).replace(/\.js$/, '');
      const target = [`${base}.d.ts`, join(base, 'index.d.ts')].find((candidate) => existsSync(candidate));
      if (target === undefined) {
        throw new Error(`${relative(ROOT, file)}: импорт ${specifier} не найден среди деклараций`);
      }
      queue.push(target);
    }
  }
  return seen;
};

describe('декларации пакета без типов typescript', () => {
  it('ни одна декларация, достижимая от входов, не импортирует typescript', () => {
    const found = reachable();
    const offenders = [...found]
      .filter(([, specifiers]) =>
        specifiers.some((value) => value === 'typescript' || value.startsWith('typescript/')),
      )
      .map(([file]) => relative(ROOT, file));
    expect(offenders).toEqual([]);
    // Выборка не выродилась: замер 17.11.2026 — 77 деклараций, среди них вход подпути и его программа.
    expect(found.size).toBeGreaterThan(60);
    expect([...found.keys()].map((file) => relative(ROOT, file))).toEqual(
      expect.arrayContaining([
        'dist/typescript/create-program.d.ts',
        'dist/types/type-script-program.type.d.ts',
      ]),
    );
  });

  it('контроль: внутренний модуль адаптера импортирует typescript — обход его находит, если он достижим', () => {
    const internal = readFileSync(join(ROOT, 'dist/types/engine-checker.type.d.ts'), 'utf8');
    expect([...internal.matchAll(SPECIFIER)].map((match) => match[1])).toContain('typescript');
    expect(reachable().has(join(ROOT, 'dist/types/engine-checker.type.d.ts'))).toBe(false);
  });
});
