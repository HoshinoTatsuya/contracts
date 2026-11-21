import { deepFreeze } from '../../deep-freeze';

/**
 * Проверки вида узла, которыми разбор формы и значений ходит по дереву. Имена —
 * как у TypeScript 5.9/6.x; у TS 7 те же функции во входе `ast/is`, кроме
 * переименованных (`NATIVE_GUARD_NAMES`). Список — и словарь фасада, и проверка
 * формы API: незнакомый компилятор без любой из них — отказ с её именем.
 */
export const SYNTAX_GUARDS = [
  'isArrayLiteralExpression',
  'isArrowFunction',
  'isAsExpression',
  'isBinaryExpression',
  'isBlock',
  'isCallExpression',
  'isComputedPropertyName',
  'isEnumDeclaration',
  'isEnumMember',
  'isExportDeclaration',
  'isExternalModuleReference',
  'isFunctionDeclaration',
  'isFunctionExpression',
  'isIdentifier',
  'isImportDeclaration',
  'isImportTypeNode',
  'isInterfaceDeclaration',
  'isLiteralTypeNode',
  'isNamedExports',
  'isNoSubstitutionTemplateLiteral',
  'isNonNullExpression',
  'isNumericLiteral',
  'isObjectLiteralExpression',
  'isParenthesizedExpression',
  'isPrefixUnaryExpression',
  'isPropertyAccessExpression',
  'isPropertyAssignment',
  'isReturnStatement',
  'isSatisfiesExpression',
  'isShorthandPropertyAssignment',
  'isSpreadElement',
  'isStringLiteral',
  'isTemplateExpression',
  'isTypeAliasDeclaration',
  'isTypeAssertionExpression',
  'isVariableDeclaration',
  'isVariableDeclarationList',
  'isVariableStatement',
] as const;
deepFreeze(SYNTAX_GUARDS);
