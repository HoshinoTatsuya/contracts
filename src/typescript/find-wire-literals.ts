import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type ts from 'typescript';

import { TypeScriptCompilerError } from '../errors/type-script-compiler.error';
import type { WireLiteralScan } from '../types/wire-literal-scan.type';
import { loadTypeScript } from './engine/load-type-script';

/**
 * Строки на проводе, записанные в коде ЛИТЕРАЛОМ вместо обращения к
 * контракту: так значения и расходятся обратно — кто-то напишет имя очереди
 * строкой рядом, компилятор смолчит, а задания уйдут в очередь, которую никто
 * не разбирает. Ищутся строковые литералы дерева разбора (комментарии и
 * пути импорта не в счёт), равные значению целиком.
 *
 * `files` в итоге — сколько файлов просмотрено: «нарушений ноль» на пустой
 * выборке неотличимо от чистого дерева, вызывающий обязан проверить и его.
 *
 * Разбирает установленный `typescript` (5.9/6.x — в процессе, 7.x — один
 * процесс компилятора на весь обход, без разрешения импортов).
 */
export function findWireLiterals(input: {
  readonly root: string;
  readonly values: readonly string[];
  /** Какие файлы смотреть (путь от корня через `/`); по умолчанию — все исходники TypeScript. */
  readonly include?: (file: string) => boolean;
  /**
   * Файлы, где значения ОБЪЯВЛЕНЫ (модуль `defineContract`, словарь констант;
   * путь от корня через `/`): литерал там — определение, а не нарушение. Без
   * этого списка файл объявления попадает в находки.
   */
  readonly declaredIn?: readonly string[];
  /** Пакет компилятора вместо `typescript` (см. `createProgram`). */
  readonly compiler?: string;
}): WireLiteralScan {
  const declared = new Set(input.declaredIn ?? []);
  const values = new Set(input.values.filter((value) => value !== ''));
  const hits: Array<{ file: string; line: number; value: string }> = [];
  const selected: Array<{ readonly file: string; readonly path: string }> = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(?:ts|tsx|mts|cts)$/.test(entry.name) || entry.name.endsWith('.d.ts')) {
        continue;
      }
      const file = relative(input.root, path).split(sep).join('/');
      if ((input.include !== undefined && !input.include(file)) || declared.has(file)) {
        continue;
      }
      selected.push({ file, path });
    }
  };
  walk(input.root);
  if (selected.length === 0 || values.size === 0) {
    return { files: selected.length, hits };
  }
  const engine = loadTypeScript(input.compiler);
  const { syntax } = engine;
  const parsed = engine.parse(selected.map(({ path }) => path));
  try {
    for (const { file, path } of selected) {
      const source = parsed.sourceFile(path);
      if (source === undefined) {
        throw new TypeScriptCompilerError(
          `typescript ${engine.compiler.version} (${engine.compiler.directory}): файл не разобран: ${path}`,
        );
      }
      const visit = (node: ts.Node): void => {
        if (
          (syntax.isStringLiteral(node) || syntax.isNoSubstitutionTemplateLiteral(node)) &&
          values.has(node.text) &&
          !syntax.isImportDeclaration(node.parent) &&
          !syntax.isExportDeclaration(node.parent) &&
          !syntax.isExternalModuleReference(node.parent) &&
          !(syntax.isLiteralTypeNode(node.parent) && syntax.isImportTypeNode(node.parent.parent))
        ) {
          hits.push({
            file,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            value: node.text,
          });
        }
        node.forEachChild(visit);
      };
      visit(source);
    }
  } finally {
    parsed.dispose();
  }
  return { files: selected.length, hits };
}
