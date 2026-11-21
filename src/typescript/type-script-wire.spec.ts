// biome-ignore-all lint/suspicious/noTemplateCurlyInString: исходник фикстуры содержит шаблонные типы ${…}
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';

import { regexOf } from '../shape/regex-of';
import type { Shape } from '../types/shape.type';
import type { TypeScriptProgram } from '../types/type-script-program.type';
import { createProgram } from './create-program';
import { shapeFromTypeScript } from './shape-from-type-script';
import { COMPILERS } from './testing/compilers.fixture';

/**
 * Типы TypeScript, у которых снимок расходился с тем, что реально едет по JSON
 * или что пропускает `tsc`:
 *
 * - необязательный член кортежа (`[string, number?]`) — может отсутствовать;
 * - член ПОСЛЕ хвоста (`[string, ...number[], boolean]`) — позиции не
 *   фиксированы, кортеж формы его не выражает;
 * - ключ-символ (`[Symbol.iterator]`) — не поле на проводе, а номер в имени
 *   (`__@iterator@37`) делал снимок недетерминированным;
 * - `${number}` в шаблоне — то, что принимает `tsc` (`1e5`, `.5`, `0x1F`);
 * - значение индексной сигнатуры `T | undefined` — JSON свойство выбрасывает.
 */
const root = mkdtempSync(join(tmpdir(), 'contracts-ts-wire-'));
const file = join(root, 'types.ts');
writeFileSync(
  file,
  [
    'export type Optional = { t: [string, number?] };',
    'export type Middle = { t: [string, ...number[], boolean] };',
    'export interface WithIterator { a: number; [Symbol.iterator](): Iterator<number> }',
    'export type Iterated = { w: { a: number; [Symbol.iterator]: () => Iterator<number> } };',
    'export type Tpl = { id: `id-${number}` };',
    'export type Dict = { d: Record<string, string | undefined> };',
    'export const accepted: Tpl[] = [{ id: "id-1e5" }, { id: "id-.5" }, { id: "id-0x1F" }, { id: "id- 7" }, { id: "id-1" }];',
  ].join('\n'),
);
const field = (shape: Shape, name: string): Shape =>
  shape.kind === 'object' ? (shape.fields[name]?.shape as Shape) : shape;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// Одна таблица на все компиляторы.
describe.each(COMPILERS)(
  'TypeScript: кортежи, символы, шаблон ${number}, словарь с undefined — %s (%s)',
  (compiler) => {
    let program: TypeScriptProgram;
    beforeAll(() => {
      program = createProgram([file], { compiler });
    });
    afterAll(() => {
      program.dispose();
    });
    const shapeOf = (type: string): Shape => shapeFromTypeScript({ file, type, program });

    it('необязательный член кортежа — объединение с undefined', () => {
      expect(field(shapeOf('Optional'), 't')).toEqual({
        kind: 'tuple',
        items: [{ kind: 'string' }, { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] }],
      });
    });

    it('необязательный член кортежа при exactOptionalPropertyTypes — тоже может отсутствовать', () => {
      const tsconfig = join(root, 'tsconfig.exact.json');
      writeFileSync(
        tsconfig,
        JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true } }),
      );
      const exact = createProgram([file], { tsconfig, compiler });
      try {
        expect(field(shapeFromTypeScript({ file, type: 'Optional', program: exact }), 't')).toEqual({
          kind: 'tuple',
          items: [
            { kind: 'string' },
            { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] },
          ],
        });
      } finally {
        exact.dispose();
      }
    });

    it('член после хвоста — opaque с границей «массив из любого члена», а не неверный порядок', () => {
      expect(field(shapeOf('Middle'), 't')).toEqual({
        kind: 'opaque',
        reason: 'кортеж с членами после хвоста: позиции членов не фиксированы',
        upper: {
          kind: 'array',
          element: { kind: 'union', options: [{ kind: 'boolean' }, { kind: 'number' }, { kind: 'string' }] },
          minItems: 2,
        },
      });
    });

    it('ключ-символ в снимок не попадает', () => {
      expect(shapeOf('WithIterator')).toEqual({
        kind: 'object',
        fields: { a: { optional: false, shape: { kind: 'number' } } },
        unknownKeys: 'strip',
      });
      expect(field(shapeOf('Iterated'), 'w')).toEqual({
        kind: 'object',
        fields: { a: { optional: false, shape: { kind: 'number' } } },
        unknownKeys: 'strip',
      });
    });

    it('${number} принимает то, что пропускает tsc, и не принимает пустое и не число', () => {
      const template = field(shapeOf('Tpl'), 'id');
      expect(template.kind).toBe('template');
      const pattern = new RegExp((template as { pattern: string }).pattern);
      // Эти строки компилятор принял в фикстуре выше (программа без ошибок).
      expect(['id-1e5', 'id-.5', 'id-0x1F', 'id- 7', 'id-1'].map((value) => pattern.test(value))).toEqual([
        true,
        true,
        true,
        true,
        true,
      ]);
      expect(['id-', 'id-x', 'id-1x', 'id-0x'].map((value) => pattern.test(value))).toEqual([
        false,
        false,
        false,
        false,
      ]);
      expect(regexOf(`/${(template as { pattern: string }).pattern}/`)).not.toBeNull();
    });

    it('значение словаря без undefined: JSON его выбрасывает', () => {
      expect(field(shapeOf('Dict'), 'd')).toEqual({
        kind: 'record',
        key: { kind: 'string' },
        value: { kind: 'string' },
      });
    });

    it('контроль: фикстура компилируется без ошибок (TypeScript 5.9)', () => {
      const control = ts.createProgram([file], {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
      });
      const errors = control
        .getSemanticDiagnostics(control.getSourceFile(file))
        .map((diagnostic) => String(diagnostic.messageText));
      expect(errors).toEqual([]);
    });
  },
);
