// biome-ignore-all lint/suspicious/noTemplateCurlyInString: исходник фикстуры содержит шаблонные типы ${…}
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import type { TypeScriptProgram } from '../types/type-script-program.type';
import { createProgram } from './create-program';
import { shapeFromTypeScript } from './shape-from-type-script';
import { COMPILERS } from './testing/compilers.fixture';
import { typeScriptContract } from './type-script-contract';

/**
 * «Золотая» таблица краёв: путь в отказе на каждом входе рекурсии (элемент
 * массива, кортежа, индексной сигнатуры, ключа), точные формы `{}`/`Object`/
 * пустого интерфейса, один и тот же тип в соседних полях (детектор рекурсии не
 * срабатывает ложно), реэкспорт (именованный, `export *`, локальный + `export {}`)
 * и потолок глубины парой «последний допустимый / первый лишний». Ожидания
 * записаны с собранного пакета и прочитаны глазами.
 */
const nest = (depth: number, inner: string): string =>
  `${'{ a: '.repeat(depth)}${inner}${' }'.repeat(depth)}`;
const wide = Array.from({ length: 300 }, (_, index) => `f${index}: string`).join('; ');
const EDGE = [
  "export * from './other';",
  // Неразрешимый модуль, пространство имён и переименование — каждый вид реэкспорта, который findDeclaration обязан пережить.
  "export * from './missing-module';",
  "export * as nsOther from './other';",
  "export { ReA as Renamed } from './other';",
  // Импорт без реэкспорта не делает имя объявленным в файле.
  "import type { Third as LocalThird } from './third';",
  'export type UsesThird = { t: LocalThird };',
  // Дополнение глобального Object (в своём файле) — Object всё ещё глобальный.
  'declare global { interface Object { augmented?: string } }',
  "export { ReA, ReB, ReBoth } from './other';",
  'export { NopeExport };',
  'export default function () { return 1; }',
  'export type Esc = { t: `a.b+${string}` };',
  'export type BigTpl = { t: `id-${bigint}` };',
  'export type ArrFn = { list: Array<() => void> };',
  'export type TupFn = { t: [string, () => void] };',
  'export type IdxFn = { [k: string]: () => void };',
  'export type SymKey = { [k: symbol]: string };',
  'export type Ctor = { make: new () => object };',
  'export interface Empty {}',
  'export type HasEmpty = { e: Empty; o: Object; b: {} };',
  'export type HasNever = { n: never };',
  'export type Loose = { u: unknown; a: any };',
  'export class WithGetter { x = 1; get y(): number { return 2; } }',
  'export type GetterHolder = { g: WithGetter };',
  'export type Point = { x: number };',
  'export type TwoPoints = { a: Point; b: Point; list: Point[] };',
  'export function fnOnly(): number { return 1; }',
  'export interface Both { a: string }',
  'export const Both = 1;',
  'interface LocalThenExport { a: string }',
  'export { LocalThenExport };',
  'export interface Twice { a: string }',
  'export interface Twice { b: string }',
  `export type DepthOk = ${nest(255, 'string')};`,
  `export type DepthOver = ${nest(256, 'string')};`,
  `export type Wide = { ${wide} };`,
].join('\n');
const OTHER = [
  'export type ReA = { a: string };',
  'export type ReB = { b: number };',
  'export interface ReBoth { c: boolean }',
  'export const ReBoth = 1;',
  'export type Starred = { s: string };',
].join('\n');
const CASES: ReadonlyArray<readonly [string, unknown]> = [
  [
    'Esc',
    {
      kind: 'object',
      fields: { t: { optional: false, shape: { kind: 'template', pattern: '^a\\.b\\+[\\s\\S]{0,}$' } } },
      unknownKeys: 'strip',
    },
  ],
  ['BigTpl', 'ContractDefinitionError: BigTpl (t): часть шаблонного типа bigint не разобрана'],
  ['ArrFn', 'ContractDefinitionError: ArrFn (list[]): функция в контракте: на проводе её нет'],
  ['TupFn', 'ContractDefinitionError: TupFn (t[1]): функция в контракте: на проводе её нет'],
  ['IdxFn', 'ContractDefinitionError: IdxFn ({*}): функция в контракте: на проводе её нет'],
  ['SymKey', 'ContractDefinitionError: SymKey ({key}): тип symbol не имеет формы на проводе'],
  ['Ctor', 'ContractDefinitionError: Ctor (make): функция в контракте: на проводе её нет'],
  [
    'HasEmpty',
    {
      kind: 'object',
      fields: {
        b: {
          optional: false,
          shape: {
            kind: 'opaque',
            reason: '{} — любое значение, кроме null и undefined',
            upper: { kind: 'unknown' },
          },
        },
        e: { optional: false, shape: { kind: 'object', fields: {}, unknownKeys: 'strip' } },
        o: {
          optional: false,
          shape: {
            kind: 'opaque',
            reason: 'Object — любое значение, кроме null и undefined',
            upper: { kind: 'unknown' },
          },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'HasNever',
    { kind: 'object', fields: { n: { optional: false, shape: { kind: 'never' } } }, unknownKeys: 'strip' },
  ],
  [
    'Loose',
    {
      kind: 'object',
      fields: {
        a: { optional: true, shape: { kind: 'unknown' } },
        u: { optional: true, shape: { kind: 'unknown' } },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'GetterHolder',
    'ContractDefinitionError: GetterHolder (g.y): аксессор (get/set): едет ли он по JSON, решает реализация — геттер класса JSON.stringify не несёт',
  ],
  [
    'TwoPoints',
    {
      kind: 'object',
      fields: {
        a: {
          optional: false,
          shape: {
            kind: 'object',
            fields: { x: { optional: false, shape: { kind: 'number' } } },
            unknownKeys: 'strip',
          },
        },
        b: {
          optional: false,
          shape: {
            kind: 'object',
            fields: { x: { optional: false, shape: { kind: 'number' } } },
            unknownKeys: 'strip',
          },
        },
        list: {
          optional: false,
          shape: {
            kind: 'array',
            element: {
              kind: 'object',
              fields: { x: { optional: false, shape: { kind: 'number' } } },
              unknownKeys: 'strip',
            },
          },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'LocalThenExport',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
  ],
  ['fnOnly', 'ContractDefinitionError: fnOnly (<dir>/edge.ts): объявление не найдено в файле'],
  [
    'Both',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
  ],
  ['Twice', 'ContractDefinitionError: Twice (<dir>/edge.ts): объявлено 2 раз'],
  [
    'ReA',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
  ],
  [
    'Renamed',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
  ],
  ['Third', 'ContractDefinitionError: Third (<dir>/edge.ts): объявление не найдено в файле'],
  [
    'UsesThird',
    {
      kind: 'object',
      fields: {
        t: {
          optional: false,
          shape: {
            kind: 'object',
            fields: { t: { optional: false, shape: { kind: 'string' } } },
            unknownKeys: 'strip',
          },
        },
      },
      unknownKeys: 'strip',
    },
  ],
  [
    'ReB',
    { kind: 'object', fields: { b: { optional: false, shape: { kind: 'number' } } }, unknownKeys: 'strip' },
  ],
  [
    'ReBoth',
    { kind: 'object', fields: { c: { optional: false, shape: { kind: 'boolean' } } }, unknownKeys: 'strip' },
  ],
  ['NopeExport', 'ContractDefinitionError: NopeExport (<dir>/edge.ts): объявление не найдено в файле'],
  [
    'Starred',
    { kind: 'object', fields: { s: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
  ],
];
const dir = mkdtempSync(join(tmpdir(), 'contracts-shape-edges-'));
beforeAll(() => {
  writeFileSync(join(dir, 'edge.ts'), EDGE);
  writeFileSync(join(dir, 'other.ts'), OTHER);
  writeFileSync(join(dir, 'third.ts'), 'export type Third = { t: string };');
  writeFileSync(join(dir, 'lonely.ts'), 'export type Lonely = { a: string };');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
const outcome = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    return error instanceof Error
      ? `${error.name}: ${error.message.split(dir).join('<dir>')}`
      : String(error);
  }
};

// Одна таблица на все компиляторы: края разбора обязаны совпасть у 5.9, 6.0 и 7.x.
describe.each(COMPILERS)('%s (%s)', (compiler) => {
  // Одна программа на таблицу файла edge.ts: сборка программы TypeScript — самая дорогая часть случая.
  let program: TypeScriptProgram;
  beforeAll(() => {
    program = createProgram([join(dir, 'edge.ts')], { compiler });
  });
  afterAll(() => {
    program.dispose();
  });
  const shape = (type: string, file = 'edge.ts', tsconfig?: string): unknown =>
    outcome(() =>
      shapeFromTypeScript({
        file: join(dir, file),
        type,
        compiler,
        ...(tsconfig === undefined ? {} : { tsconfig: join(dir, tsconfig) }),
        ...(file === 'edge.ts' && tsconfig === undefined ? { program } : {}),
      }),
    );

  describe('shapeFromTypeScript: края разбора', () => {
    it.each(CASES)('%s', (name, expected) => {
      expect(shape(name)).toEqual(expected);
    });

    it('потолок глубины: последний допустимый уровень проходит, следующий — отказ с путём', () => {
      const ok = shape('DepthOk') as { kind: string };
      expect(ok.kind).toBe('object');
      expect(shape('DepthOver')).toBe(
        `ContractDefinitionError: DepthOver (${Array.from({ length: 256 }, () => 'a').join('.')}): тип глубже ${CONTRACT_FORMAT.MAX_SHAPE_DEPTH} уровней (бесконечно раскрывающийся генерик?)`,
      );
    });

    it('глубина считается по пути, а не по числу соседних полей', () => {
      const wideShape = shape('Wide') as { fields: Record<string, unknown> };
      expect(Object.keys(wideShape.fields)).toHaveLength(300);
    });

    it('файла нет в переданной программе — отказ с причиной, а не TypeError', () => {
      expect(
        outcome(() => shapeFromTypeScript({ file: join(dir, 'lonely.ts'), type: 'Lonely', program })),
      ).toBe('ContractDefinitionError: Lonely (<dir>/lonely.ts): файл не найден программой TypeScript');
    });
  });

  describe('shapeFromTypeScript: tsconfig проекта', () => {
    beforeAll(() => {
      writeFileSync(join(dir, 'opt.ts'), 'export type Opt = { a?: string; t: [string, number?] };');
      writeFileSync(
        join(dir, 'exact.json'),
        JSON.stringify({ compilerOptions: { exactOptionalPropertyTypes: true } }),
      );
      writeFileSync(join(dir, 'bad.json'), '{ "compilerOptions": ');
      mkdirSync(join(dir, 'esm'), { recursive: true });
      writeFileSync(join(dir, 'esm', 'package.json'), JSON.stringify({ type: 'module' }));
      writeFileSync(join(dir, 'esm', 'dto.ts'), 'export type Dto = { id: string };');
      writeFileSync(
        join(dir, 'esm', 'main.ts'),
        "import type { Dto } from './dto';\nexport type Wrapped = { d: Dto };",
      );
      writeFileSync(
        join(dir, 'esm', 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler' } }),
      );
    });

    it('exactOptionalPropertyTypes: необязательное поле и элемент кортежа остаются необязательными', () => {
      const expected = {
        kind: 'object',
        fields: {
          a: { optional: true, shape: { kind: 'string' } },
          t: {
            optional: false,
            shape: {
              kind: 'tuple',
              items: [
                { kind: 'string' },
                { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] },
              ],
            },
          },
        },
        unknownKeys: 'strip',
      };
      expect(shape('Opt', 'opt.ts', 'exact.json')).toEqual(expected);
      expect(shape('Opt', 'opt.ts')).toEqual(expected);
    });

    it('moduleResolution из tsconfig: импорт без расширения разрешается; без tsconfig — отказ, а не «что угодно»', () => {
      expect(shape('Wrapped', 'esm/main.ts', 'esm/tsconfig.json')).toEqual({
        kind: 'object',
        fields: {
          d: {
            optional: false,
            shape: {
              kind: 'object',
              fields: { id: { optional: false, shape: { kind: 'string' } } },
              unknownKeys: 'strip',
            },
          },
        },
        unknownKeys: 'strip',
      });
      expect(shape('Wrapped', 'esm/main.ts')).toBe(
        'ContractDefinitionError: Wrapped (d): тип не разрешён компилятором (не найден модуль или имя): форма неизвестна',
      );
    });

    it('allowJs из tsconfig: тип из JS-модуля раскрывается; без tsconfig — отказ, а не «что угодно»', () => {
      mkdirSync(join(dir, 'js'), { recursive: true });
      writeFileSync(join(dir, 'js', 'package.json'), JSON.stringify({ type: 'module' }));
      writeFileSync(join(dir, 'js', 'dto.js'), 'export function make() { return { id: "x" }; }\n');
      writeFileSync(
        join(dir, 'js', 'main.ts'),
        "import { make } from './dto.js';\nexport type Wrapped = { d: ReturnType<typeof make> };",
      );
      writeFileSync(join(dir, 'js', 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true } }));
      expect(shape('Wrapped', 'js/main.ts', 'js/tsconfig.json')).toEqual({
        kind: 'object',
        fields: {
          d: {
            optional: false,
            shape: {
              kind: 'object',
              fields: { id: { optional: false, shape: { kind: 'string' } } },
              unknownKeys: 'strip',
            },
          },
        },
        unknownKeys: 'strip',
      });
      expect(shape('Wrapped', 'js/main.ts')).toBe(
        'ContractDefinitionError: Wrapped (d): тип не разрешён компилятором (не найден модуль или имя): форма неизвестна',
      );
    });

    it('target из tsconfig задаёт библиотеку типов: WeakRef под ES2020 не разрешён, по умолчанию (ES2022) — объект с методом', () => {
      writeFileSync(join(dir, 'weak.ts'), 'export type WithRef = { r: WeakRef<object> };');
      writeFileSync(join(dir, 'es2020.json'), JSON.stringify({ compilerOptions: { target: 'ES2020' } }));
      expect(shape('WithRef', 'weak.ts', 'es2020.json')).toBe(
        'ContractDefinitionError: WithRef (r): тип не разрешён компилятором (не найден модуль или имя): форма неизвестна',
      );
      expect(shape('WithRef', 'weak.ts')).toBe(
        'ContractDefinitionError: WithRef (r.deref): метод в контракте: на проводе его нет',
      );
    });

    // Различие компиляторов, а не адаптера: у 6.0 target ES5 устарел, у 7.x его нет — библиотека не ниже ES2015.
    it('target ES5: у 5.9 Set не разрешён, у 6.0 и 7.x — библиотека ES2015+, Set — объект с методами', () => {
      writeFileSync(join(dir, 'set.ts'), 'export type WithSet = { s: Set<string> };');
      writeFileSync(join(dir, 'es5.json'), JSON.stringify({ compilerOptions: { target: 'ES5' } }));
      expect(shape('WithSet', 'set.ts', 'es5.json')).toBe(
        compiler === 'typescript'
          ? 'ContractDefinitionError: WithSet (s): тип не разрешён компилятором (не найден модуль или имя): форма неизвестна'
          : 'ContractDefinitionError: WithSet (s.add): метод в контракте: на проводе его нет',
      );
    });

    it('tsconfig не читается — отказ с путём и причиной компилятора', () => {
      expect(shape('Opt', 'opt.ts', 'bad.json')).toBe(
        'ContractDefinitionError: tsconfig (<dir>/bad.json): Expression expected.',
      );
    });

    it('typeScriptContract: версия не разобрана — отказ до разбора типов', () => {
      expect(
        outcome(() =>
          typeScriptContract({
            name: 'task',
            version: 'v1',
            file: join(dir, 'opt.ts'),
            type: 'Opt',
            compiler,
          }),
        ),
      ).toBe('ContractDefinitionError: task: версия не разобрана: "v1"');
    });
  });
});
