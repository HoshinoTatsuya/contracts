import { dirname, join } from 'node:path';

import { TypeScriptCompilerError } from '../../errors/type-script-compiler.error';
import { COMPILERS } from '../testing/compilers.fixture';
import { loadTypeScript } from './load-type-script';
import { nativeRequire } from './native-require';
import { selectEngine } from './select-engine';

/**
 * Выбор движка — по фактическому API установленного пакета, и форма API
 * сверяется по списку всего, чем пользуется разбор. API TS 7 помечен
 * нестабильным (7.1 уже переложил входы и сменил открытие проекта): если
 * форма поменяется снова, отказ обязан назвать, ЧЕГО нет и у какой версии, а
 * не упасть `TypeError` посреди разбора. Подделки строятся из настоящих
 * модулей установленных версий с одним снятым членом — так каждый пункт
 * списка проверен на «замечает пропажу».
 */
const load = nativeRequire(join(process.cwd(), 'package.json'));
const installed = (name: string): { version: string; directory: string } => {
  const manifest = load.resolve(`${name}/package.json`);
  return { version: (load(manifest) as { version: string }).version, directory: dirname(manifest) };
};
const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof TypeScriptCompilerError
      ? `${error.name}: ${error.message}`
      : `ЧУЖОЙ ОТКАЗ: ${String(error)}`;
  }
  return 'ОТКАЗА НЕТ';
};
/** Модуль с заменёнными членами (undefined — член снят), остальное — настоящее. */
const patched = (module: unknown, changes: Readonly<Record<string, unknown>>): unknown => {
  const copy: Record<string, unknown> = { ...(module as Record<string, unknown>) };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete copy[key];
    } else {
      copy[key] = value;
    }
  }
  return copy;
};
/** Прототип класса без одного члена: у TS 7 методы проверки типов — члены прототипа (у 7.1 — геттеры). */
const withoutMember = (owner: unknown, member: string): unknown => {
  const prototype = (owner as { prototype: object }).prototype;
  const names = new Set<string>();
  for (
    let level: object | null = prototype;
    level !== null && level !== Object.prototype;
    level = Object.getPrototypeOf(level)
  ) {
    for (const name of Object.getOwnPropertyNames(level)) {
      names.add(name);
    }
  }
  names.delete(member);
  const fake = function Fake(): void {} as unknown as { prototype: object };
  fake.prototype = Object.fromEntries([...names].map((name) => [name, true]));
  return fake;
};

describe('выбор движка по API установленного typescript', () => {
  it.each(COMPILERS)('%s (%s): движок по форме API и версия пакета', (compiler, version) => {
    const engine = loadTypeScript(compiler);
    expect({
      api: engine.compiler.api,
      version: engine.compiler.version.split('.').slice(0, 2).join('.'),
    }).toEqual({
      api: version.startsWith('7.') ? 'native' : 'classic',
      version,
    });
    expect(engine.compiler.directory).toBe(installed(compiler).directory);
  });

  it('7.0 — раскладка unstable/*, 7.1 — корневые входы: у каждой версии найдена своя', () => {
    const seen: Record<string, string[]> = { 'typescript-7': [], 'typescript-7-1': [] };
    for (const name of Object.keys(seen)) {
      selectEngine(
        name,
        (id) => {
          seen[name]?.push(id);
          return load(id);
        },
        installed(name),
      );
    }
    expect(seen).toEqual({
      'typescript-7': [
        'typescript-7',
        'typescript-7/sync',
        'typescript-7/unstable/sync',
        'typescript-7/unstable/ast',
        'typescript-7/unstable/ast/is',
      ],
      'typescript-7-1': [
        'typescript-7-1',
        'typescript-7-1/sync',
        'typescript-7-1/ast',
        'typescript-7-1/ast/is',
        'typescript-7-1/fs',
      ],
    });
  });

  describe.each([
    ['typescript-7', '/unstable'],
    ['typescript-7-1', ''],
  ])('%s: снятый член API — отказ с его именем', (name, prefix) => {
    const real = (path: string): unknown => load(`${name}${prefix}/${path}`);
    const select = (replace: Readonly<Record<string, unknown>>): string =>
      refusal(() => selectEngine(name, (id) => (id in replace ? replace[id] : load(id)), installed(name)));
    const sync = `${name}${prefix}/sync`;

    it('метод проверки типов', () => {
      expect(
        select({
          [sync]: patched(real('sync'), {
            Checker: withoutMember((real('sync') as { Checker: unknown }).Checker, 'getTypeAtLocation'),
          }),
        }),
      ).toMatch(/: форма API не узнана — нет Checker\.getTypeAtLocation$/);
    });

    it('способ открыть проект', () => {
      const open = prefix === '' ? 'createSnapshot' : 'updateSnapshot';
      expect(
        select({
          [sync]: patched(real('sync'), { API: withoutMember((real('sync') as { API: unknown }).API, open) }),
        }),
      ).toMatch(new RegExp(`: форма API не узнана — нет API\\.${open}$`));
    });

    it('флаг типа и признак ошибки компилятора', () => {
      const flags = { ...(real('sync') as { TypeFlags: Record<string, number> }).TypeFlags };
      delete flags.TemplateLiteral;
      expect(select({ [sync]: patched(real('sync'), { TypeFlags: flags, isErrorType: undefined }) })).toMatch(
        new RegExp(`: форма API не узнана — нет ${sync}\\.isErrorType, TypeFlags\\.TemplateLiteral$`),
      );
    });

    it('проверка вида узла и вид узла', () => {
      const ast = real('ast') as { SyntaxKind: Record<string, number> };
      const kinds = { ...ast.SyntaxKind };
      delete kinds.AsteriskAsteriskToken;
      expect(
        select({
          [`${name}${prefix}/ast/is`]: patched(real('ast/is'), { isTypeAssertion: undefined }),
          [`${name}${prefix}/ast`]: patched(ast, { SyntaxKind: kinds }),
        }),
      ).toMatch(
        new RegExp(
          `: форма API не узнана — нет SyntaxKind\\.AsteriskAsteriskToken, ${name}${prefix}/ast/is\\.isTypeAssertion$`,
        ),
      );
    });
  });

  it('7.1: без слоя файловой системы — отказ с именем входа', () => {
    expect(
      refusal(() =>
        selectEngine(
          'typescript-7-1',
          (id) => (id === 'typescript-7-1/fs' ? {} : load(id)),
          installed('typescript-7-1'),
        ),
      ),
    ).toMatch(/: форма API не узнана — нет typescript-7-1\/fs\.createFileSystemLayer$/);
  });

  it('5.9: JS API без проверки вида узла или флага — отказ с именем', () => {
    const ts = load('typescript') as Record<string, unknown>;
    expect(
      refusal(() =>
        selectEngine(
          'typescript',
          () => patched(ts, { isSatisfiesExpression: undefined, ElementFlags: { Optional: 2 } }),
          installed('typescript'),
        ),
      ),
    ).toMatch(
      /^TypeScriptCompilerError: typescript 5\.9\.\d+ \(.+\): форма API не узнана — нет typescript\.isSatisfiesExpression, ElementFlags\.Variable$/,
    );
  });

  it('ни JS API, ни известной раскладки TS 7 — отказ со списком искомого', () => {
    const missing = Object.assign(new Error('нет входа'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    expect(
      refusal(() =>
        selectEngine(
          'typescript',
          (id) => {
            if (id === 'typescript') {
              return { version: '8.0.0' };
            }
            throw missing;
          },
          { version: '8.0.0', directory: '/pkg' },
        ),
      ),
    ).toBe(
      'TypeScriptCompilerError: typescript 8.0.0 (/pkg): форма API не узнана — нет createProgram (TypeScript 5.9/6.x), typescript/sync (TypeScript 7), typescript/unstable/sync (TypeScript 7)',
    );
  });

  it('вход есть, но не загрузился (синтаксис, require(esm) с await) — отказ «не загрузился», а не «не узнали»', () => {
    expect(
      refusal(() =>
        selectEngine(
          'typescript',
          (id) => {
            if (id === 'typescript') {
              return { version: '7.9.0' };
            }
            throw Object.assign(new Error('top-level await'), { code: 'ERR_REQUIRE_ASYNC_MODULE' });
          },
          { version: '7.9.0', directory: '/pkg' },
        ),
      ),
    ).toBe(
      'TypeScriptCompilerError: typescript 7.9.0 (/pkg): вход typescript/sync не загрузился: Error: top-level await',
    );
  });
});
