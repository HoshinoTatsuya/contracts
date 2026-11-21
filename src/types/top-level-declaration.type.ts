import type ts from 'typescript';

/**
 * Объявление верхнего уровня, которое умеет найти `findDeclaration`. Типы узлов
 * — из TypeScript 5.9 (только для сборки пакета): у TS 7 узлы той же формы.
 */
export type TopLevelDeclaration =
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration
  | ts.VariableDeclaration
  | ts.FunctionDeclaration;
