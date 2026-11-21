import type ts from 'typescript';

import type { ElementKind } from '../../types/element-kind.type';
import type { EngineChecker } from '../../types/engine-checker.type';
import type { EngineSymbol } from '../../types/engine-symbol.type';
import type { EngineType } from '../../types/engine-type.type';
import { viewOfType } from './view-of-type';

/** Проверка типов TypeScript 5.9/6.x (JS API в процессе) за общим интерфейсом. */
export function classicChecker(api: typeof ts, program: ts.Program): EngineChecker {
  const checker = program.getTypeChecker();
  const type = (value: EngineType): ts.Type => value as unknown as ts.Type;
  const symbol = (value: EngineSymbol): ts.Symbol => value as unknown as ts.Symbol;
  const wrapType = (value: ts.Type): EngineType => value as unknown as EngineType;
  const wrapSymbol = (value: ts.Symbol | undefined): EngineSymbol | undefined =>
    value as unknown as EngineSymbol | undefined;
  const symbolFlag = {
    alias: api.SymbolFlags.Alias,
    optional: api.SymbolFlags.Optional,
    method: api.SymbolFlags.Method,
    accessor: api.SymbolFlags.Accessor,
  };
  return {
    symbolAt: (node) => wrapSymbol(checker.getSymbolAtLocation(node)),
    resolveAlias: (value) =>
      (symbol(value).flags & api.SymbolFlags.Alias) === 0
        ? value
        : wrapSymbol(checker.getAliasedSymbol(symbol(value))),
    exportsOfModule: (value) =>
      checker.getExportsOfModule(symbol(value)).map((item) => wrapSymbol(item) as EngineSymbol),
    shorthandValueSymbol: (node) => wrapSymbol(checker.getShorthandAssignmentValueSymbol(node)),
    symbolName: (value) => symbol(value).getName(),
    escapedName: (value) => String(symbol(value).escapedName),
    symbolIs: (value, what) => (symbol(value).flags & symbolFlag[what]) !== 0,
    declarations: (value) => symbol(value).declarations ?? [],
    valueDeclaration: (value) => symbol(value).valueDeclaration,
    constantValue: (node) => checker.getConstantValue(node),
    typeAt: (node) => wrapType(checker.getTypeAtLocation(node)),
    typeOfSymbolAt: (value, node) => wrapType(checker.getTypeOfSymbolAtLocation(symbol(value), node)),
    typeToString: (value) => checker.typeToString(type(value)),
    view: (value) =>
      viewOfType(type(value), type(value).flags, api.TypeFlags, {
        isError: (item) => (item as unknown as { intrinsicName?: string }).intrinsicName === 'error',
        // Булев литерал 5.9/6.x — встроенный тип с именем `true`/`false`, без `value`.
        literal: (item) =>
          (item.flags & api.TypeFlags.BooleanLiteral) !== 0
            ? (item as unknown as { intrinsicName: string }).intrinsicName === 'true'
            : ((item as ts.LiteralType).value as string | number),
        members: (item) => (item as ts.UnionOrIntersectionType | ts.TemplateLiteralType).types ?? [],
        texts: (item) => (item as ts.TemplateLiteralType).texts,
      }),
    typeSymbol: (value) => wrapSymbol(type(value).getSymbol()),
    isPrimitiveLike: (value) =>
      (type(value).flags &
        (api.TypeFlags.StringLike |
          api.TypeFlags.NumberLike |
          api.TypeFlags.BooleanLike |
          api.TypeFlags.BigIntLike)) !==
      0,
    isArray: (value) => checker.isArrayType(type(value)),
    isTuple: (value) => checker.isTupleType(type(value)),
    typeArguments: (value) => checker.getTypeArguments(type(value) as ts.TypeReference).map(wrapType),
    tupleElements: (value) =>
      ((type(value) as ts.TypeReference).target as ts.TupleType).elementFlags.map(
        (flags): ElementKind =>
          (flags & api.ElementFlags.Variable) !== 0
            ? 'variable'
            : (flags & api.ElementFlags.Optional) !== 0
              ? 'optional'
              : 'required',
      ),
    properties: (value) =>
      checker.getPropertiesOfType(type(value)).map((item) => wrapSymbol(item) as EngineSymbol),
    indexInfos: (value) =>
      checker
        .getIndexInfosOfType(type(value))
        .map((info) => ({ key: wrapType(info.keyType), value: wrapType(info.type) })),
    isCallable: (value) =>
      type(value).getCallSignatures().length > 0 || type(value).getConstructSignatures().length > 0,
    isDefaultLibrary: (node) => program.isSourceFileDefaultLibrary(node.getSourceFile()),
  };
}
