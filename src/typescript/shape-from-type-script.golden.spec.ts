// biome-ignore-all lint/suspicious/noTemplateCurlyInString: исходник фикстуры содержит шаблонные типы ${…}
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TypeScriptProgram } from '../types/type-script-program.type';
import { createProgram } from './create-program';
import { shapeFromTypeScript } from './shape-from-type-script';
import { COMPILERS } from './testing/compilers.fixture';

/**
 * «Золотая» таблица: точный итог (код, путь, ТЕКСТ) на каждый случай. Ожидания записаны
 * генератором с собранного пакета и прочитаны глазами; изменение поведения или текста находки
 * обязано менять эту таблицу осознанно.
 */
const FILES: Readonly<Record<string, string>> = {
  'types.ts':
    'export enum Color { Red = "red", Blue = "blue" }\nexport enum Num { A, B }\nexport interface Base { id: string; n?: number; u: string | undefined }\nexport type Literals = { s: "a"; n: 1; t: true; f: false; big: bigint; nul: null; nev?: never; un: undefined };\nexport type Coll = { arr: string[]; ro: readonly number[]; tup: [string, number?, ...boolean[]]; nested: { x: Color }[] };\nexport type Records = { r: Record<string, number>; n: { [k: number]: string }; mixed: { known: string; [k: string]: string } };\nexport type Tpl = { a: `id-${number}`; b: `${string}:x` };\nexport type Unions = { u: string | number | null; e: Color | "green"; n: Num };\nexport type Ext = Base & { extra: boolean };\nexport type Brand = { id: string & { __brand: "Id" } };\nexport type Fn = { f: () => void };\nexport interface WithMethod { m(): void }\nexport type Two = { [k: string]: string; [n: number]: string };\nexport type Gen<T> = { v: T };\nexport type GenS = Gen<string>;\nexport type Sym = { s: symbol };\nexport type BadTpl = { t: `${boolean}` };\nexport type When = { at: Date };',
};
const CASES: ReadonlyArray<readonly [string, unknown]> = [
  [
    'Base',
    {
      kind: 'object',
      fields: {
        id: { optional: false, shape: { kind: 'string' } },
        n: { optional: true, shape: { kind: 'number' } },
        u: { optional: true, shape: { kind: 'string' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'Literals',
    {
      kind: 'object',
      fields: {
        big: { optional: false, shape: { kind: 'bigint' } },
        f: { optional: false, shape: { kind: 'literal', value: false } },
        n: { optional: false, shape: { kind: 'literal', value: 1 } },
        nev: { optional: true, shape: { kind: 'never' } },
        nul: { optional: false, shape: { kind: 'null' } },
        s: { optional: false, shape: { kind: 'enum', values: ['a'] } },
        t: { optional: false, shape: { kind: 'literal', value: true } },
        un: { optional: true, shape: { kind: 'never' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'Coll',
    {
      kind: 'object',
      fields: {
        arr: { optional: false, shape: { kind: 'array', element: { kind: 'string' } } },
        nested: {
          optional: false,
          shape: {
            kind: 'array',
            element: {
              kind: 'object',
              fields: { x: { optional: false, shape: { kind: 'enum', values: ['blue', 'red'] } } },
              unknownKeys: 'strip',
            },
          },
        },
        ro: { optional: false, shape: { kind: 'array', element: { kind: 'number' } } },
        tup: {
          optional: false,
          shape: {
            kind: 'tuple',
            items: [
              { kind: 'string' },
              { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] },
            ],
            rest: { kind: 'boolean' },
          },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'Records',
    {
      kind: 'object',
      fields: {
        mixed: {
          optional: false,
          shape: {
            kind: 'object',
            fields: { known: { optional: false, shape: { kind: 'string' } } },
            unknownKeys: 'keep',
            rest: { kind: 'string' },
          },
        },
        n: {
          optional: false,
          shape: {
            kind: 'record',
            key: { kind: 'string', patterns: ['/^(?:-?\\d+(?:\\.\\d+)?(?:e[+-]\\d+)?|NaN|-?Infinity)$/'] },
            value: { kind: 'string' },
          },
        },
        r: { optional: false, shape: { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'Tpl',
    {
      kind: 'object',
      fields: {
        a: {
          optional: false,
          shape: {
            kind: 'template',
            // Как проверяет TypeScript: непустая строка с конечным `+s` (`1e5`, `.5`, `0x1F`, пробелы).
            pattern:
              '^id-(?:\\s*(?:[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)\\s*|\\s+)$',
          },
        },
        b: { optional: false, shape: { kind: 'template', pattern: '^[\\s\\S]{0,}:x$' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'Unions',
    {
      kind: 'object',
      fields: {
        e: { optional: false, shape: { kind: 'enum', values: ['blue', 'green', 'red'] } },
        n: {
          optional: false,
          shape: {
            kind: 'union',
            options: [
              { kind: 'literal', value: 0 },
              { kind: 'literal', value: 1 },
            ],
          },
        },
        u: {
          optional: false,
          shape: { kind: 'union', options: [{ kind: 'null' }, { kind: 'number' }, { kind: 'string' }] },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'Ext',
    {
      kind: 'object',
      fields: {
        extra: { optional: false, shape: { kind: 'boolean' } },
        id: { optional: false, shape: { kind: 'string' } },
        n: { optional: true, shape: { kind: 'number' } },
        u: { optional: true, shape: { kind: 'string' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'Brand',
    { kind: 'object', fields: { id: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
  ],
  ['Fn', 'ContractDefinitionError: Fn (f): функция в контракте: на проводе её нет'],
  ['WithMethod', 'ContractDefinitionError: WithMethod (m): метод в контракте: на проводе его нет'],
  ['Two', 'ContractDefinitionError: Two: несколько индексных сигнатур'],
  [
    'GenS',
    { kind: 'object', fields: { v: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
  ],
  ['Sym', 'ContractDefinitionError: Sym (s): тип symbol не имеет формы на проводе'],
  [
    'BadTpl',
    {
      kind: 'object',
      fields: { t: { optional: false, shape: { kind: 'enum', values: ['false', 'true'] } } },
      unknownKeys: 'strip',
    },
  ],
  [
    'When',
    { kind: 'object', fields: { at: { optional: false, shape: { kind: 'date' } } }, unknownKeys: 'strip' },
  ],
  ['Color', { kind: 'enum', values: ['blue', 'red'] }],
  ['Missing', 'ContractDefinitionError: Missing (<dir>/types.ts): объявление не найдено в файле'],
];
const dir = mkdtempSync(join(tmpdir(), 'contracts-ts-shape-golden-'));
beforeAll(() => {
  for (const [name, text] of Object.entries(FILES)) {
    writeFileSync(join(dir, name), text);
  }
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Одна таблица на все компиляторы: снимок на одних исходниках обязан совпасть у 5.9, 6.0 и 7.x.
describe.each(COMPILERS)('shapeFromTypeScript: точные формы и отказы — %s (%s)', (compiler) => {
  let program: TypeScriptProgram;
  beforeAll(() => {
    program = createProgram([join(dir, 'types.ts')], { compiler });
  });
  afterAll(() => {
    program.dispose();
  });

  it.each(CASES)('%s', (name, expected) => {
    let result: unknown;
    try {
      result = shapeFromTypeScript({ file: join(dir, 'types.ts'), type: name, program });
    } catch (error) {
      result =
        error instanceof Error ? `${error.name}: ${error.message.split(dir).join('<dir>')}` : String(error);
    }
    expect(result).toEqual(expected);
  });
});
