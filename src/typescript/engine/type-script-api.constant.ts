import { deepFreeze } from '../../deep-freeze';

/**
 * Что разбор берёт из компилятора, кроме проверок вида узла: имена флагов и
 * видов узлов (числа у TS 5.9/6.x и TS 7 разные — берутся по имени из
 * установленного пакета), члены JS API 5.9/6.x и раскладки программного API
 * TS 7. Тот же список — проверка формы: пакет, у которого чего-то нет, —
 * отказ с названием недостающего, а не `TypeError` посреди разбора.
 */
export const TYPE_SCRIPT_API = {
  typeFlags: [
    'Any',
    'Unknown',
    'Never',
    'Undefined',
    'Void',
    'Null',
    'StringLiteral',
    'NumberLiteral',
    'BooleanLiteral',
    'BigInt',
    'BigIntLiteral',
    'Boolean',
    'String',
    'Number',
    'TemplateLiteral',
    'NonPrimitive',
    'TypeParameter',
    'ESSymbolLike',
    'Index',
    'Union',
    'Intersection',
    'Object',
    'StringLike',
    'NumberLike',
    'BooleanLike',
    'BigIntLike',
  ],
  symbolFlags: ['Alias', 'Optional', 'Method', 'Accessor'],
  elementFlags: ['Optional', 'Variable'],
  syntaxKinds: [
    'PlusToken',
    'MinusToken',
    'AsteriskToken',
    'AsteriskAsteriskToken',
    'SlashToken',
    'PercentToken',
    'TrueKeyword',
    'FalseKeyword',
    'NullKeyword',
  ],
  nodeFlags: ['Const'],
  /** JS API TypeScript 5.9/6.x. */
  classic: [
    'createProgram',
    'createSourceFile',
    'readConfigFile',
    'parseJsonConfigFileContent',
    'flattenDiagnosticMessageText',
    'sys',
    'ScriptTarget',
    'ModuleKind',
    'ModuleResolutionKind',
    'TypeFlags',
    'SymbolFlags',
    'ElementFlags',
    'SyntaxKind',
    'NodeFlags',
  ],
  /**
   * Раскладки синхронного API TS 7 — от новой к старой. 7.1 перенёс входы из
   * `unstable/*` в корень пакета и заменил `updateSnapshot` на `createSnapshot`
   * со слоем файловой системы; 7.0 открывает проект через обратные вызовы
   * файловой системы.
   */
  nativeLayouts: [
    { dialect: 'create-snapshot', prefix: '', open: 'createSnapshot' },
    { dialect: 'update-snapshot', prefix: '/unstable', open: 'updateSnapshot' },
  ],
  nativeFunctions: ['isErrorType'],
  nativeEnums: ['TypeFlags', 'SymbolFlags', 'ElementFlags', 'SignatureKind'],
  nativeChecker: [
    'getSymbolAtLocation',
    'getAliasedSymbol',
    'getExportsOfModule',
    'getShorthandAssignmentValueSymbol',
    'getConstantValue',
    'getTypeAtLocation',
    'getTypeOfSymbolAtLocation',
    'typeToString',
    'isArrayType',
    'isTupleType',
    'getTypeArguments',
    'getPropertiesOfType',
    'getIndexInfosOfType',
    'getSignaturesOfType',
    'getStringType',
  ],
  nativeProgram: ['getSourceFile', 'isSourceFileDefaultLibrary', 'getConfigFileParsingDiagnostics'],
  nativeType: ['getTypes', 'getSymbol', 'getTarget'],
  nativeNodeHandle: ['resolve'],
  /**
   * Запасной компилятор, когда `typescript` проекта не годится (нет пакета или
   * форма API незнакома): прежний JS API отдельным пакетом (TypeScript 6).
   */
  fallback: '@typescript/typescript6',
  /** Проверки вида узла, переименованные в TS 7: имя 5.9/6.x → имя во входе `ast/is`. */
  nativeGuardNames: { isTypeAssertionExpression: 'isTypeAssertion' },
} as const;
deepFreeze(TYPE_SCRIPT_API);
