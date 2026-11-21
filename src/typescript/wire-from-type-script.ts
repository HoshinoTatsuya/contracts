import { resolve } from 'node:path';

import type ts from 'typescript';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import { setOwn } from '../shape/set-own';
import type { TypeScriptProgram } from '../types/type-script-program.type';
import type { WireValue } from '../types/wire-value.type';
import { findDeclaration } from './find-declaration';
import { withProgram } from './with-program';

/**
 * Значения на проводе из исходника TypeScript — разбором и вычислением, а не
 * поиском подстроки: комментарий и запись числа (`20 * 60_000` против
 * `1_200_000`) на результат не влияют. Для стороны, которая ещё не объявляет
 * контракт через `defineContract`, а держит словарь констант.
 *
 * Пути — как у `wireFromValues` с объектом `{ ИМЯ }`: `QUEUE_NAMES.scan`,
 * `KEYS.lock`. Узнаются: строки, числа (с `+ - * / % **` и унарным минусом),
 * `true`/`false`/`null`, шаблонные строки из констант, ссылки на константы и
 * члены enum (в том числе импортированные — через компилятор), вложенные
 * объекты и массивы, `Object.freeze(…)`, `as const`/`satisfies`, и
 * построители ключей — стрелочные функции, чьё тело — шаблон из параметров и
 * констант (`(id) => \`lock:${id}\`` → `lock:${0}`). Всё прочее — отказ:
 * «не смог разобрать» и «совпадает» — разные ответы.
 *
 * Компилятор — установленный `typescript` 5.9/6.x или 7.x; без `program`
 * своя программа собирается и освобождается внутри вызова.
 */
export function wireFromTypeScript(input: {
  readonly file: string;
  readonly names: readonly string[];
  readonly tsconfig?: string;
  /** Пакет компилятора вместо `typescript` (см. `createProgram`). */
  readonly compiler?: string;
  readonly program?: TypeScriptProgram;
}): Record<string, WireValue> {
  return withProgram(input, (engine, program) => {
    const { syntax } = engine;
    const { checker } = program;
    const source = program.sourceFile(resolve(input.file));
    if (source === undefined) {
      throw new ContractDefinitionError('wire', input.file, 'файл не найден программой TypeScript');
    }
    const values: Record<string, WireValue> = {};
    const fail = (path: string, node: ts.Node): never => {
      throw new ContractDefinitionError(
        'wire',
        path,
        `форма значения не разобрана: ${node.getText(node.getSourceFile()).slice(0, 200)}`,
      );
    };
    // Ключ «a.b» и вложенный a: { b } дают один путь: второе значение молча затёрло бы первое.
    const put = (path: string, entry: WireValue): void => {
      if (Object.hasOwn(values, path)) {
        throw new ContractDefinitionError(
          'wire',
          path,
          'два значения дают один путь (ключ с точкой рядом с вложенным объектом)',
        );
      }
      setOwn(values, path, entry);
    };
    const unwrap = (node: ts.Expression): ts.Expression => {
      let current = node;
      while (
        syntax.isAsExpression(current) ||
        syntax.isSatisfiesExpression(current) ||
        syntax.isParenthesizedExpression(current) ||
        syntax.isNonNullExpression(current) ||
        syntax.isTypeAssertionExpression(current)
      ) {
        current = current.expression;
      }
      if (
        syntax.isCallExpression(current) &&
        current.arguments.length === 1 &&
        syntax.isPropertyAccessExpression(current.expression) &&
        current.expression.getText() === 'Object.freeze'
      ) {
        return unwrap(current.arguments[0] as ts.Expression);
      }
      return current;
    };

    type Scalar = string | number | boolean | null;

    // let/var может быть переприсвоен до отправки: объявленное значение — не то, что уходит на провод.
    const isConst = (declaration: ts.VariableDeclaration): boolean =>
      syntax.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & syntax.NodeFlags.Const) !== 0;
    const notConst = (path: string): never => {
      throw new ContractDefinitionError(
        'wire',
        path,
        'объявлено через let/var: значение может быть переприсвоено до отправки — нужен const',
      );
    };

    /** Объявление, на которое указывает идентификатор или обращение к члену. */
    const resolveNode = (node: ts.Expression, path: string): ts.Expression | number | string => {
      let symbol = checker.symbolAt(node);
      const first = symbol === undefined ? undefined : checker.valueDeclaration(symbol);
      if (first !== undefined && syntax.isShorthandPropertyAssignment(first)) {
        symbol = checker.shorthandValueSymbol(first);
      }
      if (symbol !== undefined) {
        symbol = checker.resolveAlias(symbol);
      }
      const declaration =
        symbol === undefined
          ? undefined
          : (checker.valueDeclaration(symbol) ?? checker.declarations(symbol)[0]);
      if (declaration === undefined) {
        return fail(path, node);
      }
      if (syntax.isEnumMember(declaration)) {
        const value = checker.constantValue(declaration);
        return value === undefined ? fail(path, node) : value;
      }
      if (syntax.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        return isConst(declaration) ? declaration.initializer : notConst(path);
      }
      if (syntax.isPropertyAssignment(declaration)) {
        return declaration.initializer;
      }
      return fail(path, node);
    };

    const scalar = (node: ts.Expression, path: string, params: readonly string[], depth: number): Scalar => {
      if (depth > 32) {
        return fail(path, node);
      }
      const expression = unwrap(node);
      if (syntax.isStringLiteral(expression) || syntax.isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text;
      }
      if (syntax.isNumericLiteral(expression)) {
        // Разделители разрядов (`60_000`) компилятор в text уже снял.
        return Number(expression.text);
      }
      if (expression.kind === syntax.SyntaxKind.TrueKeyword) {
        return true;
      }
      if (expression.kind === syntax.SyntaxKind.FalseKeyword) {
        return false;
      }
      if (expression.kind === syntax.SyntaxKind.NullKeyword) {
        return null;
      }
      if (syntax.isPrefixUnaryExpression(expression)) {
        const operand = scalar(expression.operand, path, params, depth + 1);
        if (typeof operand !== 'number') {
          return fail(path, expression);
        }
        if (expression.operator === syntax.SyntaxKind.MinusToken) {
          return -operand;
        }
        return expression.operator === syntax.SyntaxKind.PlusToken ? operand : fail(path, expression);
      }
      if (syntax.isTemplateExpression(expression)) {
        return (
          expression.head.text +
          expression.templateSpans
            .map((span) => `${String(scalar(span.expression, path, params, depth + 1))}${span.literal.text}`)
            .join('')
        );
      }
      if (syntax.isBinaryExpression(expression)) {
        const left = scalar(expression.left, path, params, depth + 1);
        const right = scalar(expression.right, path, params, depth + 1);
        if (expression.operatorToken.kind === syntax.SyntaxKind.PlusToken) {
          if (typeof left === 'string' || typeof right === 'string') {
            return `${String(left)}${String(right)}`;
          }
        }
        if (typeof left !== 'number' || typeof right !== 'number') {
          return fail(path, expression);
        }
        switch (expression.operatorToken.kind) {
          case syntax.SyntaxKind.PlusToken:
            return left + right;
          case syntax.SyntaxKind.MinusToken:
            return left - right;
          case syntax.SyntaxKind.AsteriskToken:
            return left * right;
          case syntax.SyntaxKind.SlashToken:
            return left / right;
          case syntax.SyntaxKind.PercentToken:
            return left % right;
          case syntax.SyntaxKind.AsteriskAsteriskToken:
            return left ** right;
          default:
            return fail(path, expression);
        }
      }
      if (syntax.isIdentifier(expression) && params.includes(expression.text)) {
        return `\${${params.indexOf(expression.text)}}`;
      }
      if (syntax.isIdentifier(expression) || syntax.isPropertyAccessExpression(expression)) {
        const target = resolveNode(expression, path);
        return typeof target === 'object' ? scalar(target, path, params, depth + 1) : target;
      }
      return fail(path, expression);
    };

    /** Построитель ключа — стрелка, функциональное выражение или объявление функции: тело — шаблон из параметров. */
    const builder = (
      fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
      path: string,
      depth: number,
    ): void => {
      const params = fn.parameters.map((parameter) =>
        syntax.isIdentifier(parameter.name) &&
        parameter.dotDotDotToken === undefined &&
        parameter.initializer === undefined
          ? parameter.name.text
          : fail(path, fn),
      );
      let body: ts.Expression | undefined;
      if (fn.body === undefined) {
        body = undefined;
      } else if (syntax.isBlock(fn.body)) {
        const [statement] = fn.body.statements;
        body =
          fn.body.statements.length === 1 && statement !== undefined && syntax.isReturnStatement(statement)
            ? statement.expression
            : undefined;
      } else {
        body = fn.body;
      }
      if (body === undefined) {
        fail(path, fn);
        return;
      }
      const rendered = scalar(body, path, params, depth + 1);
      if (typeof rendered !== 'string') {
        fail(path, fn);
      }
      put(path, { type: 'template', arity: params.length, value: rendered as string });
    };

    const visit = (node: ts.Expression, path: string, depth: number): void => {
      if (depth > 32) {
        fail(path, node);
      }
      const expression = unwrap(node);
      if (syntax.isObjectLiteralExpression(expression)) {
        for (const property of expression.properties) {
          let key: string | undefined;
          let value: ts.Expression | undefined;
          if (syntax.isPropertyAssignment(property)) {
            value = property.initializer;
            if (
              syntax.isIdentifier(property.name) ||
              syntax.isStringLiteral(property.name) ||
              syntax.isNumericLiteral(property.name)
            ) {
              key = property.name.text;
            } else if (syntax.isComputedPropertyName(property.name)) {
              const computed = scalar(property.name.expression, path, [], depth + 1);
              key =
                typeof computed === 'string' || typeof computed === 'number' ? String(computed) : undefined;
            }
          } else if (syntax.isShorthandPropertyAssignment(property)) {
            key = property.name.text;
            value = property.name;
          }
          // Метод, геттер, spread и ключ, не сводимый к строке, — сюда же: ключа нет.
          if (key === undefined || value === undefined) {
            fail(path, property as unknown as ts.Expression);
          }
          visit(value as ts.Expression, `${path}.${String(key)}`, depth + 1);
        }
        return;
      }
      if (syntax.isArrayLiteralExpression(expression)) {
        expression.elements.forEach((element, index) => {
          if (syntax.isSpreadElement(element)) {
            fail(path, element);
          }
          visit(element, `${path}[${index}]`, depth + 1);
        });
        return;
      }
      if (syntax.isArrowFunction(expression) || syntax.isFunctionExpression(expression)) {
        builder(expression, path, depth);
        return;
      }
      if (syntax.isIdentifier(expression) || syntax.isPropertyAccessExpression(expression)) {
        const target = resolveNode(expression, path);
        if (typeof target === 'object') {
          visit(target, path, depth + 1);
          return;
        }
        put(
          path,
          typeof target === 'string' ? { type: 'string', value: target } : { type: 'number', value: target },
        );
        return;
      }
      const value = scalar(expression, path, [], depth + 1);
      if (typeof value === 'number' && !Number.isFinite(value)) {
        fail(path, expression);
      }
      put(
        path,
        value === null
          ? { type: 'null' }
          : typeof value === 'string'
            ? { type: 'string', value }
            : typeof value === 'number'
              ? { type: 'number', value }
              : { type: 'boolean', value },
      );
    };

    for (const name of input.names) {
      const declaration = findDeclaration(source, resolve(input.file), name, 'value', syntax, checker);
      if (syntax.isEnumDeclaration(declaration)) {
        for (const member of declaration.members) {
          const value = checker.constantValue(member);
          const path = `${name}.${member.name.getText()}`;
          if (value === undefined) {
            fail(path, member.name as unknown as ts.Expression);
          }
          put(
            path,
            typeof value === 'string'
              ? { type: 'string', value }
              : { type: 'number', value: value as number },
          );
        }
      } else if (syntax.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        if (!isConst(declaration)) {
          notConst(name);
        }
        visit(declaration.initializer, name, 0);
      } else if (syntax.isFunctionDeclaration(declaration)) {
        builder(declaration, name, 0);
      } else {
        fail(name, declaration);
      }
    }
    return values;
  });
}
