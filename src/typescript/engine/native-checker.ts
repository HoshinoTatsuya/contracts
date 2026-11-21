import type ts from 'typescript';

import { TypeScriptCompilerError } from '../../errors/type-script-compiler.error';
import type { ElementKind } from '../../types/element-kind.type';
import type { EngineChecker } from '../../types/engine-checker.type';
import type { EngineSymbol } from '../../types/engine-symbol.type';
import type { EngineType } from '../../types/engine-type.type';
import type { Native } from '../../types/native.type';
import type { TypeScriptCompiler } from '../../types/type-script-compiler.type';
import type { TYPE_SCRIPT_API } from './type-script-api.constant';
import { viewOfType } from './view-of-type';

/**
 * Проверка типов TypeScript 7 (процесс на Go) за общим интерфейсом. Отличия
 * от 5.9/6.x, которые закрывает адаптер: объявления символа — ссылки на узлы
 * (`resolve()`), булев литерал несёт `value`, поле индексной сигнатуры —
 * `valueType`, сигнатуры — через проверку типов.
 */
export function nativeChecker(
  modules: Native.Modules,
  project: Native.Project,
  compiler: TypeScriptCompiler,
): EngineChecker {
  const { checker, program } = project;
  const { SymbolFlags, ElementFlags, SignatureKind } = modules.sync;
  const flag = (table: Native.Table, name: string): number => table[name] ?? 0;
  const type = (value: EngineType): Native.Type => value as unknown as Native.Type;
  const symbol = (value: EngineSymbol): Native.Symbol => value as unknown as Native.Symbol;
  const wrapType = (value: Native.Type): EngineType => value as unknown as EngineType;
  const wrapSymbol = (value: Native.Symbol): EngineSymbol => value as unknown as EngineSymbol;
  const resolveNode = (handle: Native.Handle | undefined): ts.Node | undefined => handle?.resolve();
  const symbolFlag = {
    alias: flag(SymbolFlags, 'Alias'),
    optional: flag(SymbolFlags, 'Optional'),
    method: flag(SymbolFlags, 'Method'),
    accessor: flag(SymbolFlags, 'Accessor'),
  };
  const table = modules.sync.TypeFlags as Readonly<
    Record<(typeof TYPE_SCRIPT_API)['typeFlags'][number], number>
  >;
  const primitiveLike =
    flag(table, 'StringLike') |
    flag(table, 'NumberLike') |
    flag(table, 'BooleanLike') |
    flag(table, 'BigIntLike');
  return {
    symbolAt: (node) => {
      const found = checker.getSymbolAtLocation(node);
      return found === undefined ? undefined : wrapSymbol(found);
    },
    resolveAlias: (value) => {
      if ((symbol(value).flags & symbolFlag.alias) === 0) {
        return value;
      }
      // Нераспознанная цель — «неизвестный символ» без объявлений: дальше это «не найдено», как у 5.9/6.x.
      return wrapSymbol(checker.getAliasedSymbol(symbol(value)));
    },
    exportsOfModule: (value) => checker.getExportsOfModule(symbol(value)).map(wrapSymbol),
    shorthandValueSymbol: (node) => {
      const found = checker.getShorthandAssignmentValueSymbol(node);
      return found === undefined ? undefined : wrapSymbol(found);
    },
    symbolName: (value) => symbol(value).name,
    escapedName: (value) => String(symbol(value).escapedName),
    symbolIs: (value, what) => (symbol(value).flags & symbolFlag[what]) !== 0,
    declarations: (value) =>
      (symbol(value).declarations ?? [])
        .map(resolveNode)
        .filter((node): node is ts.Node => node !== undefined),
    valueDeclaration: (value) => resolveNode(symbol(value).valueDeclaration),
    constantValue: (node) => checker.getConstantValue(node),
    typeAt: (node) => {
      const found = checker.getTypeAtLocation(node);
      if (found === undefined) {
        throw new TypeScriptCompilerError(
          `typescript ${compiler.version} (${compiler.directory}): компилятор не вернул тип узла ${node.getText()}`,
        );
      }
      return wrapType(found);
    },
    typeOfSymbolAt: (value, node) => wrapType(checker.getTypeOfSymbolAtLocation(symbol(value), node)),
    typeToString: (value) => checker.typeToString(type(value)),
    view: (value) =>
      viewOfType(type(value), type(value).flags, table, {
        isError: (item) => modules.sync.isErrorType(item),
        literal: (item) => item.value as string | number | boolean | undefined,
        members: (item) => item.getTypes() ?? [],
        texts: (item) => item.texts ?? [],
      }),
    typeSymbol: (value) => {
      const found = type(value).getSymbol();
      return found === undefined ? undefined : wrapSymbol(found);
    },
    isPrimitiveLike: (value) => (type(value).flags & primitiveLike) !== 0,
    isArray: (value) => checker.isArrayType(type(value)),
    isTuple: (value) => checker.isTupleType(type(value)),
    typeArguments: (value) => checker.getTypeArguments(type(value)).map(wrapType),
    tupleElements: (value) =>
      (type(value).getTarget().elementFlags ?? []).map(
        (flags): ElementKind =>
          (flags & flag(ElementFlags, 'Variable')) !== 0
            ? 'variable'
            : (flags & flag(ElementFlags, 'Optional')) !== 0
              ? 'optional'
              : 'required',
      ),
    properties: (value) => checker.getPropertiesOfType(type(value)).map(wrapSymbol),
    indexInfos: (value) =>
      checker
        .getIndexInfosOfType(type(value))
        .map((info) => ({ key: wrapType(info.keyType), value: wrapType(info.valueType) })),
    isCallable: (value) =>
      checker.getSignaturesOfType(type(value), flag(SignatureKind, 'Call')).length > 0 ||
      checker.getSignaturesOfType(type(value), flag(SignatureKind, 'Construct')).length > 0,
    isDefaultLibrary: (node) => program.isSourceFileDefaultLibrary(node.getSourceFile()),
  };
}
