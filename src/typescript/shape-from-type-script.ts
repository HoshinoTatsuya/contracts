import { resolve } from 'node:path';

import type ts from 'typescript';

import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { ContractDefinitionError } from '../errors/contract-definition.error';
import { canonicalShape } from '../shape/canonical-shape';
import { patternLiteral } from '../shape/pattern-literal';
import { setOwn } from '../shape/set-own';
import { withoutUndefined } from '../shape/without-undefined';
import type { EngineType } from '../types/engine-type.type';
import type { FieldShape } from '../types/field-shape.type';
import type { Shape } from '../types/shape.type';
import type { TypeScriptProgram } from '../types/type-script-program.type';
import { findDeclaration } from './find-declaration';
import { withProgram } from './with-program';

/**
 * Форма на проводе по интерфейсу или псевдониму типа TypeScript — через
 * КОМПИЛЯТОР, а не по тексту: псевдонимы, `extends`, пересечения, импорты,
 * `Pick`/`Omit`, enum и `as const`-словари раскрываются в то, что реально
 * едет, поэтому `'http' | 'https'` и `Proto` (псевдоним того же) — одна форма,
 * а перенос строки расхождения не даёт.
 *
 * Строковые литералы и строковые enum — набор строк на проводе (`enum`),
 * необязательность — `?`, `| undefined`, а также `unknown`/`any` (значение
 * `undefined` по JSON пропадает вместе с полем), индексная сигнатура —
 * открытый объект (`keep`), без свойств — словарь. Неизвестные поля интерфейс
 * не отвергает: `unknownKeys` — `strip` (что писатель на типе может их
 * положить, снимок помечает `extraFields: 'unchecked'`). `object` — объект или
 * массив с чем угодно; `{}` и `Object` (подходит и примитив) — `opaque`.
 *
 * Функция, символ, параметр типа, аксессор (`get`/`set`: геттер класса
 * `JSON.stringify` не несёт), рекурсивный тип и вложенность глубже
 * `CONTRACT_FORMAT.MAX_SHAPE_DEPTH` (бесконечно раскрывающийся генерик) —
 * отказ с путём.
 *
 * Компилятор — установленный `typescript` 5.9/6.x или 7.x (форма одна и та же,
 * разбор идёт через адаптер); без `program` своя программа собирается и
 * освобождается внутри вызова.
 */
export function shapeFromTypeScript(input: {
  readonly file: string;
  readonly type: string;
  readonly tsconfig?: string;
  /** Пакет компилятора вместо `typescript` (см. `createProgram`). */
  readonly compiler?: string;
  readonly program?: TypeScriptProgram;
}): Shape {
  return withProgram(input, (engine, program) => {
    const { syntax } = engine;
    const { checker } = program;
    const source = program.sourceFile(resolve(input.file));
    if (source === undefined) {
      throw new ContractDefinitionError(input.type, input.file, 'файл не найден программой TypeScript');
    }
    const declaration = findDeclaration(source, resolve(input.file), input.type, 'type', syntax, checker);
    const anchor: ts.Node = declaration.name ?? declaration;
    const stack: EngineType[] = [];
    let depth = 0;
    const fail = (path: string, detail: string): never => {
      throw new ContractDefinitionError(input.type, path, detail);
    };
    const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const template = (texts: readonly string[], parts: readonly EngineType[], path: string): Shape => {
      let pattern = `^${escapeRegex(texts[0] ?? '')}`;
      parts.forEach((part, index) => {
        const kind = checker.view(part).kind;
        if (kind === 'string') {
          pattern += '[\\s\\S]{0,}';
        } else if (kind === 'number') {
          // Как проверяет TypeScript: непустая строка, у которой `+s` конечно (` 1`, `1e5`, `.5`, `0x1F`, пробелы).
          pattern +=
            '(?:\\s*(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)\\s*|\\s+)';
        } else {
          fail(path, `часть шаблонного типа ${checker.typeToString(part)} не разобрана`);
        }
        pattern += escapeRegex(texts[index + 1] ?? '');
      });
      return { kind: 'template', pattern: `${pattern}$` };
    };

    const objectShape = (type: EngineType, path: string): Shape => {
      const typeSymbol = checker.typeSymbol(type);
      const symbolName = typeSymbol === undefined ? undefined : checker.symbolName(typeSymbol);
      if (symbolName === 'Date') {
        return { kind: 'date' };
      }
      // Глобальный `Object` (подходит и примитив): его свойства — методы прототипа, а не поля на проводе.
      if (
        symbolName === 'Object' &&
        typeSymbol !== undefined &&
        checker.declarations(typeSymbol).some((node) => checker.isDefaultLibrary(node))
      ) {
        return {
          kind: 'opaque',
          reason: 'Object — любое значение, кроме null и undefined',
          upper: { kind: 'unknown' },
        };
      }
      if (checker.isArray(type)) {
        const [element] = checker.typeArguments(type);
        return {
          kind: 'array',
          element: element === undefined ? { kind: 'unknown' } : visit(element, `${path}[]`),
        };
      }
      if (checker.isTuple(type)) {
        const kinds = checker.tupleElements(type);
        const items: Shape[] = [];
        let rest: Shape | undefined;
        let afterRest = false;
        const every: Shape[] = [];
        let required = 0;
        checker.typeArguments(type).forEach((element, index) => {
          const kind = kinds[index] ?? 'required';
          const shape = visit(element, `${path}[${index}]`);
          every.push(shape);
          if (kind === 'variable') {
            rest = shape;
          } else if (rest !== undefined) {
            // Член ПОСЛЕ хвоста (`[string, ...number[], boolean]`): кортеж формы так не выражает.
            afterRest = true;
            required += kind === 'optional' ? 0 : 1;
          } else if (kind === 'optional') {
            items.push({ kind: 'union', options: [shape, { kind: 'undefined' }] });
          } else {
            items.push(shape);
            required += 1;
          }
        });
        if (afterRest) {
          return {
            kind: 'opaque',
            reason: 'кортеж с членами после хвоста: позиции членов не фиксированы',
            upper: {
              kind: 'array',
              element: { kind: 'union', options: every },
              ...(required === 0 ? {} : { minItems: required }),
            },
          };
        }
        return { kind: 'tuple', items, ...(rest === undefined ? {} : { rest }) };
      }
      const properties = checker.properties(type);
      if (checker.isCallable(type)) {
        return fail(path, 'функция в контракте: на проводе её нет');
      }
      const indexes = checker.indexInfos(type);
      if (properties.length === 0 && indexes.length === 0 && symbolName === '__type') {
        return {
          kind: 'opaque',
          reason: '{} — любое значение, кроме null и undefined',
          upper: { kind: 'unknown' },
        };
      }
      const fields: Record<string, FieldShape> = {};
      for (const property of properties) {
        // Ключ-символ (`[Symbol.iterator]`, `__@iterator@37`) и приватное поле класса JSON не несёт.
        const escaped = checker.escapedName(property);
        if (escaped.startsWith('__@') || escaped.startsWith('__#')) {
          continue;
        }
        const name = checker.symbolName(property);
        const fieldPath = path === '' ? name : `${path}.${name}`;
        if (checker.symbolIs(property, 'method')) {
          fail(fieldPath, 'метод в контракте: на проводе его нет');
        }
        if (checker.symbolIs(property, 'accessor')) {
          fail(
            fieldPath,
            'аксессор (get/set): едет ли он по JSON, решает реализация — геттер класса JSON.stringify не несёт',
          );
        }
        const propertyType = checker.typeOfSymbolAt(property, anchor);
        const propertyKind = checker.view(propertyType).kind;
        const loose = propertyKind === 'any' || propertyKind === 'unknown';
        const inner = withoutUndefined(visit(propertyType, fieldPath));
        setOwn(fields, name, {
          optional: checker.symbolIs(property, 'optional') || inner.hadUndefined || loose,
          shape: inner.shape,
        });
      }
      if (indexes.length > 1) {
        return fail(path, 'несколько индексных сигнатур');
      }
      const [index] = indexes;
      if (index === undefined) {
        return { kind: 'object', fields, unknownKeys: 'strip' };
      }
      // Свойство со значением undefined JSON выбрасывает: на проводе значения словаря без undefined.
      const value = withoutUndefined(visit(index.value, `${path}{*}`)).shape;
      if (properties.length === 0) {
        const keyIsNumber = checker.view(index.key).kind === 'number';
        return {
          kind: 'record',
          key: keyIsNumber
            ? // Ключ — String(число): `1`, `-1.5`, `1e+21`, `NaN`, `Infinity`.
              {
                kind: 'string',
                patterns: [patternLiteral('^(?:-?\\d+(?:\\.\\d+)?(?:e[+-]\\d+)?|NaN|-?Infinity)$', '')],
              }
            : visit(index.key, `${path}{key}`),
          value,
        };
      }
      return { kind: 'object', fields, unknownKeys: 'keep', rest: value };
    };

    const visitAt = (type: EngineType, path: string): Shape => {
      const view = checker.view(type);
      switch (view.kind) {
        // Не найденный модуль или имя компилятор подставляет как any («error»): это не «что угодно», а неизвестная форма.
        case 'error':
          return fail(path, `тип не разрешён компилятором (не найден модуль или имя): форма неизвестна`);
        case 'any':
        case 'unknown':
          return { kind: 'unknown' };
        case 'never':
          return { kind: 'never' };
        case 'undefined':
          return { kind: 'undefined' };
        case 'null':
          return { kind: 'null' };
        case 'string-literal':
          return { kind: 'enum', values: [view.value] };
        case 'number-literal':
        case 'boolean-literal':
          return { kind: 'literal', value: view.value };
        case 'bigint':
          return { kind: 'bigint' };
        case 'boolean':
          return { kind: 'boolean' };
        case 'string':
          return { kind: 'string' };
        case 'number':
          return { kind: 'number' };
        case 'template':
          return template(view.texts, view.parts, path);
        case 'non-primitive':
          // `object`: объект или массив, внутри — что угодно.
          return {
            kind: 'union',
            options: [
              { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'unknown' } },
              { kind: 'array', element: { kind: 'unknown' } },
            ],
          };
        case 'unshaped':
          return fail(path, `тип ${checker.typeToString(type)} не имеет формы на проводе`);
        case 'union':
          return { kind: 'union', options: view.members.map((member) => visit(member, path)) };
        default:
          break;
      }
      if (stack.includes(type)) {
        return fail(path, `рекурсивный тип ${checker.typeToString(type)}: снимок рекурсии не поддерживается`);
      }
      stack.push(type);
      try {
        if (view.kind === 'intersection') {
          const primitive = view.members.find((member) => checker.isPrimitiveLike(member));
          // Брендированный примитив (`string & { __brand: 'Id' }`) на проводе — сам примитив.
          return primitive === undefined ? objectShape(type, path) : visit(primitive, path);
        }
        if (view.kind === 'object') {
          return objectShape(type, path);
        }
        return fail(path, `тип ${checker.typeToString(type)} не разобран`);
      } finally {
        stack.pop();
      }
    };

    const visit = (type: EngineType, path: string): Shape => {
      if (depth >= CONTRACT_FORMAT.MAX_SHAPE_DEPTH) {
        return fail(
          path,
          `тип глубже ${CONTRACT_FORMAT.MAX_SHAPE_DEPTH} уровней (бесконечно раскрывающийся генерик?)`,
        );
      }
      depth += 1;
      try {
        return visitAt(type, path);
      } finally {
        depth -= 1;
      }
    };

    return canonicalShape(visit(checker.typeAt(anchor), ''));
  });
}
