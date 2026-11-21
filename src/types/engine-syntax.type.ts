import type ts from 'typescript';

import type { SYNTAX_GUARDS } from '../typescript/engine/syntax-guards.constant';

/**
 * Фасад дерева разбора: проверки вида узла и словари видов. Типы узлов — из
 * TypeScript 5.9 (только для компиляции пакета): у TS 7 узлы той же формы
 * (`kind`, `parent`, `name`, `initializer`, `getText`…), а числа видов берутся
 * из словарей установленного компилятора, а не из констант.
 */
export type EngineSyntax = Pick<typeof ts, (typeof SYNTAX_GUARDS)[number]> & {
  readonly SyntaxKind: typeof ts.SyntaxKind;
  readonly NodeFlags: typeof ts.NodeFlags;
};
