import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findWireLiterals } from './find-wire-literals';
import { COMPILERS } from './testing/compilers.fixture';

/**
 * Обход дерева и отбор литералов — на дереве, где у каждого правила есть
 * случай, который оно одно отличает: вложенный каталог (путь через `/`),
 * пропускаемые каталоги, `.d.ts`, расширение не в конце имени, файл не
 * TypeScript, файл объявления; литералы-двойники, которые находкой НЕ являются
 * (пути импорта/реэкспорта/`require`/`import()` в типе, идентификатор с тем же
 * текстом, другой литерал, пустая строка), и те, что являются (шаблон без
 * подстановок, литеральный тип).
 */
const root = mkdtempSync(join(tmpdir(), 'contracts-wire-literals-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (file: string, text: string): void => {
  const parts = file.split('/');
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...parts), text);
};

beforeAll(() => {
  write(
    'src/a.ts',
    [
      "import x from 'q:v';",
      "export { y } from 'q:v';",
      "import r = require('q:v');",
      "type I = import('q:v').X;",
      "const s = 'q:v';",
      'const t = `q:v`;',
      "type L = 'q:v';",
      "const other = 'other';",
      "const empty = '';",
      'const ident = 1;',
    ].join('\n'),
  );
  write('src/nested/deep.ts', "export const n = 'q:v';");
  write('src/contracts.ts', "export const QUEUE = 'q:v';");
  for (const skipped of ['node_modules/pkg/index.ts', '.git/x.ts', 'dist/out.ts']) {
    write(skipped, "export const z = 'q:v';");
  }
  write('types.d.ts', "declare const d: 'q:v';");
  write('notes.ts.txt', "const n = 'q:v';");
  write('readme.md', "'q:v'");
});

describe.each(COMPILERS)('findWireLiterals: обход и отбор — %s (%s)', (compiler) => {
  // Порядок обхода каталога зависит от файловой системы — сравнивается отсортированный список.
  const sorted = <T extends { file: string; line: number }>(hits: readonly T[]): T[] =>
    [...hits].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  it('находки — только литералы значений в исходниках TypeScript, путь от корня через /', () => {
    const scan = findWireLiterals({
      compiler,
      root,
      values: ['q:v', '', 'ident'],
      declaredIn: ['src/contracts.ts'],
    });
    expect({ files: scan.files, hits: sorted(scan.hits) }).toEqual({
      files: 2,
      hits: [
        { file: 'src/a.ts', line: 5, value: 'q:v' },
        { file: 'src/a.ts', line: 6, value: 'q:v' },
        { file: 'src/a.ts', line: 7, value: 'q:v' },
        { file: 'src/nested/deep.ts', line: 1, value: 'q:v' },
      ],
    });
  });

  it('без declaredIn файл объявления — тоже находка', () => {
    const { files, hits } = findWireLiterals({ compiler, root, values: ['q:v'] });
    expect(files).toBe(3);
    expect(hits).toContainEqual({ file: 'src/contracts.ts', line: 1, value: 'q:v' });
  });
});
