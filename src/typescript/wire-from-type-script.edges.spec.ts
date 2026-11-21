// biome-ignore-all lint/suspicious/noTemplateCurlyInString: исходник фикстуры содержит шаблоны TypeScript
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TypeScriptProgram } from '../types/type-script-program.type';
import { createProgram } from './create-program';
import { COMPILERS } from './testing/compilers.fixture';
import { wireFromTypeScript } from './wire-from-type-script';

/**
 * «Золотая» таблица краёв разбора: на каждую ветку отказа — случай, где она одна
 * отличает отказ от неверного значения; циклы ссылок через каждое ребро рекурсии
 * (без потолка глубины — переполнение стека, а не отказ); потолок глубины — парами
 * «последний допустимый / первый лишний» на каждом входе в рекурсию. Ожидания
 * записаны с собранного пакета и прочитаны глазами.
 */
const nest = (depth: number, inner: string): string =>
  `${'{ a: '.repeat(depth)}${inner}${' }'.repeat(depth)}`;
const longArgs = Array.from({ length: 80 }, (_, index) => index).join(', ');
const EDGE = [
  "export enum Kind { A = 'a' }",
  'export enum Num { One = 1, Two = 2 }',
  "export enum Computed { A = 'x'.length }",
  'export declare const AMBIENT: string;',
  'export declare function DECL_FN(a: string): string;',
  'export let LET_TOP = { v: 1 };',
  "const SOURCE_OBJ = { key: 'v', nested: { n: 1 } };",
  'interface Merged { a: string }',
  "const Merged = 'merged';",
  'const CV1: unknown = CV2;',
  'const CV2: unknown = CV1;',
  'const U1: number = -U2;',
  'const U2: number = -U1;',
  'const T1: string = `${T2}`;',
  'const T2: string = `${T1}`;',
  'const B1: number = B2 + 1;',
  'const B2: number = B1 + 1;',
  'const R1: number = 1 + R2;',
  'const R2: number = 1 + R1;',
  'const O1: unknown = { a: O2 };',
  'const O2: unknown = { a: O1 };',
  'const A1: unknown = [A2];',
  'const A2: unknown = [A1];',
  "export const DUP = { 'a.b': 1, a: { b: 2 } };",
  `export const LONG = { v: Math.max(${longArgs}) };`,
  'export const FREEZE2 = { v: Object.freeze({ x: 1 }, { y: 2 }) };',
  'export const OTHER_CALL = { v: JSON.stringify({ x: 1 }) };',
  'export const UNDECLARED = { v: NOPE_UNDECLARED };',
  'export const MERGED = { v: Merged };',
  'export const ENUM_COMPUTED = { v: Computed.A };',
  'export const AMBIENT_REF = { v: AMBIENT };',
  'export const PROP_REF = { v: SOURCE_OBJ.key, n: SOURCE_OBJ.nested };',
  'export const NEG_BOOL = { v: -true };',
  'export const TILDE = { v: ~1 };',
  "export const STR_MINUS = { v: 'a' - 1 };",
  "export const NUM_TIMES_STR = { v: 2 * '3' };",
  'export const TPL_ENUM = { v: `x:${Kind.A}`, n: `n:${Num.Two}` };',
  "export const REST = { f: (...a: string[]) => 'k' };",
  "export const DESTRUCT = { f: ({ a }: { a: string }) => 'k' };",
  "export const RETURN_FIRST = { f: function () { return 'k'; 'dead'; } };",
  'export const EMPTY_BODY = { f: () => {} };',
  'export const NUM_BUILDER = { f: () => 5 };',
  "export const BIGINT_KEY = { 1n: 'x' };",
  'export const BOOL_KEY = { [true]: 1 };',
  "export const NUM_KEY = { [1 + 1]: 'two' };",
  'export const CYC_VISIT = { v: CV1 };',
  'export const CYC_UNARY = { v: U1 };',
  'export const CYC_TPL = { v: T1 };',
  'export const CYC_LEFT = { v: B1 };',
  'export const CYC_RIGHT = { v: R1 };',
  'export const CYC_OBJ = { v: O1 };',
  'export const CYC_ARR = { v: A1 };',
  `export const DEPTH_LITERAL_OK = ${nest(31, '1')};`,
  `export const DEPTH_LITERAL_OVER = ${nest(32, '1')};`,
  `export const DEPTH_EMPTY_OK = ${nest(32, '{}')};`,
  `export const DEPTH_EMPTY_OVER = ${nest(33, '{}')};`,
  `export const DEPTH_BUILDER_OK = ${nest(31, "() => 'k'")};`,
  `export const DEPTH_BUILDER_OVER = ${nest(32, "() => 'k'")};`,
  `export const DEPTH_KEY_OK = ${nest(30, "{ [`${'k'}`]: {} }")};`,
  `export const DEPTH_KEY_OVER = ${nest(31, "{ [`${'k'}`]: {} }")};`,
].join('\n');
const CASES: ReadonlyArray<readonly [string, unknown]> = [
  ['Kind', { 'Kind.A': { type: 'string', value: 'a' } }],
  ['Num', { 'Num.One': { type: 'number', value: 1 }, 'Num.Two': { type: 'number', value: 2 } }],
  ['Computed', 'ContractDefinitionError: wire (Computed.A): форма значения не разобрана: A'],
  ['AMBIENT', 'ContractDefinitionError: wire (AMBIENT): форма значения не разобрана: AMBIENT: string'],
  [
    'DECL_FN',
    'ContractDefinitionError: wire (DECL_FN): форма значения не разобрана: export declare function DECL_FN(a: string): string;',
  ],
  [
    'LET_TOP',
    'ContractDefinitionError: wire (LET_TOP): объявлено через let/var: значение может быть переприсвоено до отправки — нужен const',
  ],
  [
    'DUP',
    'ContractDefinitionError: wire (DUP.a.b): два значения дают один путь (ключ с точкой рядом с вложенным объектом)',
  ],
  [
    'LONG',
    'ContractDefinitionError: wire (LONG.v): форма значения не разобрана: Math.max(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 5',
  ],
  [
    'FREEZE2',
    'ContractDefinitionError: wire (FREEZE2.v): форма значения не разобрана: Object.freeze({ x: 1 }, { y: 2 })',
  ],
  [
    'OTHER_CALL',
    'ContractDefinitionError: wire (OTHER_CALL.v): форма значения не разобрана: JSON.stringify({ x: 1 })',
  ],
  [
    'UNDECLARED',
    'ContractDefinitionError: wire (UNDECLARED.v): форма значения не разобрана: NOPE_UNDECLARED',
  ],
  ['MERGED', { 'MERGED.v': { type: 'string', value: 'merged' } }],
  // Имя объявлено и интерфейсом, и константой: значение — только константа.
  ['Merged', { Merged: { type: 'string', value: 'merged' } }],
  [
    'ENUM_COMPUTED',
    'ContractDefinitionError: wire (ENUM_COMPUTED.v): форма значения не разобрана: Computed.A',
  ],
  ['AMBIENT_REF', 'ContractDefinitionError: wire (AMBIENT_REF.v): форма значения не разобрана: AMBIENT'],
  [
    'PROP_REF',
    { 'PROP_REF.v': { type: 'string', value: 'v' }, 'PROP_REF.n.n': { type: 'number', value: 1 } },
  ],
  ['NEG_BOOL', 'ContractDefinitionError: wire (NEG_BOOL.v): форма значения не разобрана: -true'],
  ['TILDE', 'ContractDefinitionError: wire (TILDE.v): форма значения не разобрана: ~1'],
  ['STR_MINUS', "ContractDefinitionError: wire (STR_MINUS.v): форма значения не разобрана: 'a' - 1"],
  ['NUM_TIMES_STR', "ContractDefinitionError: wire (NUM_TIMES_STR.v): форма значения не разобрана: 2 * '3'"],
  [
    'TPL_ENUM',
    { 'TPL_ENUM.v': { type: 'string', value: 'x:a' }, 'TPL_ENUM.n': { type: 'string', value: 'n:2' } },
  ],
  ['REST', "ContractDefinitionError: wire (REST.f): форма значения не разобрана: (...a: string[]) => 'k'"],
  [
    'DESTRUCT',
    "ContractDefinitionError: wire (DESTRUCT.f): форма значения не разобрана: ({ a }: { a: string }) => 'k'",
  ],
  [
    'RETURN_FIRST',
    "ContractDefinitionError: wire (RETURN_FIRST.f): форма значения не разобрана: function () { return 'k'; 'dead'; }",
  ],
  ['EMPTY_BODY', 'ContractDefinitionError: wire (EMPTY_BODY.f): форма значения не разобрана: () => {}'],
  ['NUM_BUILDER', 'ContractDefinitionError: wire (NUM_BUILDER.f): форма значения не разобрана: () => 5'],
  ['BIGINT_KEY', "ContractDefinitionError: wire (BIGINT_KEY): форма значения не разобрана: 1n: 'x'"],
  ['BOOL_KEY', 'ContractDefinitionError: wire (BOOL_KEY): форма значения не разобрана: [true]: 1'],
  ['NUM_KEY', { 'NUM_KEY.2': { type: 'string', value: 'two' } }],
  ['CYC_VISIT', 'ContractDefinitionError: wire (CYC_VISIT.v): форма значения не разобрана: CV1'],
  ['CYC_UNARY', 'ContractDefinitionError: wire (CYC_UNARY.v): форма значения не разобрана: -U1'],
  ['CYC_TPL', 'ContractDefinitionError: wire (CYC_TPL.v): форма значения не разобрана: `${T1}`'],
  ['CYC_LEFT', 'ContractDefinitionError: wire (CYC_LEFT.v): форма значения не разобрана: B1 + 1'],
  ['CYC_RIGHT', 'ContractDefinitionError: wire (CYC_RIGHT.v): форма значения не разобрана: 1 + R1'],
  [
    'CYC_OBJ',
    'ContractDefinitionError: wire (CYC_OBJ.v.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a): форма значения не разобрана: O1',
  ],
  [
    'CYC_ARR',
    'ContractDefinitionError: wire (CYC_ARR.v[0][0][0][0][0][0][0][0][0][0][0][0][0][0][0][0]): форма значения не разобрана: A1',
  ],
  [
    'DEPTH_LITERAL_OK',
    {
      'DEPTH_LITERAL_OK.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a': {
        type: 'number',
        value: 1,
      },
    },
  ],
  [
    'DEPTH_LITERAL_OVER',
    'ContractDefinitionError: wire (DEPTH_LITERAL_OVER.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a): форма значения не разобрана: 1',
  ],
  ['DEPTH_EMPTY_OK', {}],
  [
    'DEPTH_EMPTY_OVER',
    'ContractDefinitionError: wire (DEPTH_EMPTY_OVER.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a): форма значения не разобрана: {}',
  ],
  [
    'DEPTH_BUILDER_OK',
    {
      'DEPTH_BUILDER_OK.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a': {
        type: 'template',
        arity: 0,
        value: 'k',
      },
    },
  ],
  [
    'DEPTH_BUILDER_OVER',
    "ContractDefinitionError: wire (DEPTH_BUILDER_OVER.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a): форма значения не разобрана: 'k'",
  ],
  ['DEPTH_KEY_OK', {}],
  [
    'DEPTH_KEY_OVER',
    "ContractDefinitionError: wire (DEPTH_KEY_OVER.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a): форма значения не разобрана: 'k'",
  ],
];
const dir = mkdtempSync(join(tmpdir(), 'contracts-wire-edges-'));
beforeAll(() => {
  writeFileSync(join(dir, 'edge.ts'), EDGE);
  writeFileSync(join(dir, 'lonely.ts'), 'export const LONELY = { a: 1 };');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Одна таблица на все компиляторы: значения обязаны совпасть у 5.9, 6.0 и 7.x.
describe.each(COMPILERS)('wireFromTypeScript: края разбора — %s (%s)', (compiler) => {
  // Одна программа на всю таблицу: сборка программы TypeScript — самая дорогая часть случая.
  let program: TypeScriptProgram;
  beforeAll(() => {
    program = createProgram([join(dir, 'edge.ts')], { compiler });
  });
  afterAll(() => {
    program.dispose();
  });

  it.each(CASES)('%s', (name, expected) => {
    let result: unknown;
    try {
      result = wireFromTypeScript({ file: join(dir, 'edge.ts'), names: [name], program });
    } catch (error) {
      result =
        error instanceof Error ? `${error.name}: ${error.message.split(dir).join('<dir>')}` : String(error);
    }
    expect(result).toEqual(expected);
  });

  it('файла нет в переданной программе — отказ с причиной, а не TypeError', () => {
    expect(() => wireFromTypeScript({ file: join(dir, 'lonely.ts'), names: ['LONELY'], program })).toThrow(
      `wire (${join(dir, 'lonely.ts')}): файл не найден программой TypeScript`,
    );
    expect(wireFromTypeScript({ file: join(dir, 'edge.ts'), names: ['Kind'], program })).toEqual({
      'Kind.A': { type: 'string', value: 'a' },
    });
  });
});
