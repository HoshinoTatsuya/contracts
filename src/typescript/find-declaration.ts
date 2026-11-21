import type ts from 'typescript';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import type { EngineChecker } from '../types/engine-checker.type';
import type { EngineSymbol } from '../types/engine-symbol.type';
import type { EngineSyntax } from '../types/engine-syntax.type';
import type { TopLevelDeclaration as Found } from '../types/top-level-declaration.type';

/**
 * Объявление верхнего уровня по имени: интерфейс, псевдоним типа, enum,
 * константа или функция (построитель ключа). Реэкспорт (`export { Dto } from
 * './dto'`, `export { Local as Dto }`, `export * from './dto'`) разворачивается
 * компилятором до исходного объявления; одно объявление, достигнутое двумя
 * путями, считается один раз. Не найдено или найдено больше одного раза — отказ:
 * гейт, читающий «первое попавшееся», сверял бы мёртвую копию.
 *
 * `file` — путь, как его назвал вызывающий: в отказе он, а не имя файла
 * внутри компилятора (TS 7 может назвать файл по настоящему пути).
 */
export function findDeclaration(
  source: ts.SourceFile,
  file: string,
  name: string,
  kinds: 'type' | 'value',
  syntax: EngineSyntax,
  checker: EngineChecker,
): Found {
  const found: Found[] = [];
  // Одно объявление, достигнутое двумя путями (`interface Dto {}` + `export { Dto }`, именованный реэкспорт рядом с
  // `export *`), — одно, а не «объявлено 2 раза». Узел — по файлу и месту: у TS 7 ссылка на объявление
  // разворачивается в узел заново.
  const key = (node: ts.Node): string =>
    `${node.getSourceFile().fileName}:${node.pos}:${node.end}:${node.kind}`;
  const add = (node: Found | undefined): void => {
    if (node !== undefined && !found.some((known) => key(known) === key(node))) {
      found.push(node);
    }
  };
  const accepts = (node: ts.Node): node is Found =>
    syntax.isEnumDeclaration(node) ||
    (kinds === 'type' && (syntax.isInterfaceDeclaration(node) || syntax.isTypeAliasDeclaration(node))) ||
    (kinds === 'value' && (syntax.isVariableDeclaration(node) || syntax.isFunctionDeclaration(node)));
  const target = (symbol: EngineSymbol | undefined): Found | undefined => {
    const resolved = symbol === undefined ? undefined : checker.resolveAlias(symbol);
    return resolved === undefined ? undefined : checker.declarations(resolved).find(accepts);
  };
  for (const statement of source.statements) {
    if (
      (syntax.isInterfaceDeclaration(statement) ||
        syntax.isTypeAliasDeclaration(statement) ||
        syntax.isEnumDeclaration(statement) ||
        syntax.isFunctionDeclaration(statement)) &&
      statement.name?.text === name &&
      accepts(statement)
    ) {
      add(statement);
    } else if (kinds === 'value' && syntax.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (syntax.isIdentifier(declaration.name) && declaration.name.text === name) {
          add(declaration);
        }
      }
    } else if (syntax.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause === undefined) {
        // `export * from './dto'`: имя — среди экспортов модуля (компилятор разворачивает цепочки).
        const origin =
          statement.moduleSpecifier === undefined ? undefined : checker.symbolAt(statement.moduleSpecifier);
        add(
          target(
            origin === undefined
              ? undefined
              : checker.exportsOfModule(origin).find((symbol) => checker.symbolName(symbol) === name),
          ),
        );
      } else if (syntax.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.name.text === name) {
            add(target(checker.symbolAt(element.name)));
          }
        }
      }
    }
  }
  const [declaration] = found;
  if (found.length !== 1 || declaration === undefined) {
    throw new ContractDefinitionError(
      name,
      file,
      found.length === 0 ? 'объявление не найдено в файле' : `объявлено ${found.length} раз`,
    );
  }
  return declaration;
}
