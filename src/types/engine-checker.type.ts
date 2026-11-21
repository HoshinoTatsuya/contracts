import type ts from 'typescript';

import type { ElementKind } from './element-kind.type';
import type { EngineSymbol } from './engine-symbol.type';
import type { EngineType } from './engine-type.type';
import type { TypeView } from './type-view.type';

/**
 * Проверка типов за адаптером: ровно то, что нужно разбору формы и значений,
 * одинаково у TS 5.9/6.x и TS 7. Различия (флаги, объявления-ссылки, значение
 * булева литерала, поле индексной сигнатуры) закрывает адаптер, а не общий код.
 */
export interface EngineChecker {
  symbolAt(node: ts.Node): EngineSymbol | undefined;
  /** Псевдоним (импорт, реэкспорт) — его цель; не псевдоним — сам символ; цель не разрешена — `undefined`. */
  resolveAlias(symbol: EngineSymbol): EngineSymbol | undefined;
  exportsOfModule(module: EngineSymbol): readonly EngineSymbol[];
  shorthandValueSymbol(node: ts.ShorthandPropertyAssignment): EngineSymbol | undefined;
  symbolName(symbol: EngineSymbol): string;
  escapedName(symbol: EngineSymbol): string;
  symbolIs(symbol: EngineSymbol, what: 'alias' | 'optional' | 'method' | 'accessor'): boolean;
  declarations(symbol: EngineSymbol): readonly ts.Node[];
  valueDeclaration(symbol: EngineSymbol): ts.Node | undefined;
  constantValue(node: ts.EnumMember): string | number | undefined;
  typeAt(node: ts.Node): EngineType;
  typeOfSymbolAt(symbol: EngineSymbol, node: ts.Node): EngineType;
  typeToString(type: EngineType): string;
  view(type: EngineType): TypeView;
  typeSymbol(type: EngineType): EngineSymbol | undefined;
  /** Строковый, числовой, булев или bigint-подобный (в том числе литерал): брендированный примитив. */
  isPrimitiveLike(type: EngineType): boolean;
  isArray(type: EngineType): boolean;
  isTuple(type: EngineType): boolean;
  typeArguments(type: EngineType): readonly EngineType[];
  tupleElements(type: EngineType): readonly ElementKind[];
  properties(type: EngineType): readonly EngineSymbol[];
  indexInfos(type: EngineType): ReadonlyArray<{ readonly key: EngineType; readonly value: EngineType }>;
  /** Есть сигнатура вызова или конструктора. */
  isCallable(type: EngineType): boolean;
  /** Узел объявлен в стандартной библиотеке (`lib.*.d.ts`). */
  isDefaultLibrary(node: ts.Node): boolean;
}
