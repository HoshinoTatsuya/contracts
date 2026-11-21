import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { loadSnapshotModule } from './cli/load-snapshot-module';
import { parseFlags } from './cli/parse-flags';
import { CONTRACT_FORMAT } from './constants/contract-format.constant';
import { FINDING_CODE } from './constants/finding-code.constant';
import { deepFreeze } from './deep-freeze';
import { ContractDefinitionError } from './errors/contract-definition.error';
import { ContractPayloadError } from './errors/contract-payload.error';
import { ContractVersionError } from './errors/contract-version.error';
import { ShapeComparisonError } from './errors/shape-comparison.error';
import { quoteCmdArgument } from './process/quote-cmd-argument';
import { checkRoutes } from './routes/check-routes';
import { defineContract } from './runtime/define-contract';
import { findUnknownFields } from './runtime/find-unknown-fields';
import { isPlainObject } from './runtime/is-plain-object';
import { issuePath } from './runtime/issue-path';
import { mergeUnknownFields } from './runtime/merge-unknown-fields';
import { notifyObserver } from './runtime/notify-observer';
import { createSnapshot } from './snapshot/create-snapshot';
import { parseSnapshot } from './snapshot/parse-snapshot';
import { serializeSnapshot } from './snapshot/serialize-snapshot';
import type { ContractSnapshot } from './types/contract-snapshot.type';
import { compareVersions } from './version/compare-versions';
import { parseVersion } from './version/parse-version';

/**
 * «Золотая» таблица краёв мелких частей: точный текст каждого отказа (метка,
 * путь, перечисление через запятую), допустимые значения рядом с запрещёнными
 * (двойники), границы потолков. Ожидания записаны с собранного пакета и
 * прочитаны глазами.
 */
const outcome = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
};

describe('разбор снимка: документ, запись, значение на проводе', () => {
  const base = JSON.parse(
    serializeSnapshot(
      createSnapshot({ reads: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({}) })] }),
    ),
  ) as { format: string; contracts: { m: Record<string, unknown> } };
  const doc = (patch: Record<string, unknown>): string =>
    JSON.stringify({ ...base, contracts: { m: { ...base.contracts.m, ...patch } } });
  const prefix = 'SnapshotFormatError: peer: не снимок контрактов:';

  it.each<readonly [string, string, string]>([
    ['документ-строка', '"str"', `${prefix} документ — не объект, а string`],
    [
      'contracts: null',
      JSON.stringify({ format: base.format, contracts: null }),
      `${prefix} нет словаря contracts`,
    ],
    [
      'два незнакомых ключа записи',
      doc({ x: 1, y: 2 }),
      `${prefix} контракт m: незнакомые ключи записи: x, y`,
    ],
    ['wire — строка', doc({ wire: 'str' }), `${prefix} контракт m: wire — не словарь`],
    [
      'тип значения — свойство прототипа',
      doc({ wire: { q: { type: 'toString' } } }),
      `${prefix} контракт m: wire q: неизвестный тип "toString"`,
    ],
    [
      'тип значения — массив со строкой',
      doc({ wire: { q: { type: ['string'], value: 'x' } } }),
      `${prefix} контракт m: wire q: неизвестный тип ["string"]`,
    ],
    [
      'два незнакомых поля значения',
      doc({ wire: { q: { type: 'null', a: 1, b: 2 } } }),
      `${prefix} контракт m: wire q: незнакомые поля a, b`,
    ],
    [
      'число с булевым значением',
      doc({ wire: { q: { type: 'number', value: true } } }),
      `${prefix} контракт m: wire q: значение не того вида для типа number`,
    ],
  ])('%s', (_name, text, expected) => {
    expect(outcome(() => parseSnapshot(text, 'peer'))).toBe(expected);
  });

  it('createSnapshot: имя не строка, повтор, свой отказ источника — проходит как есть', () => {
    const entry = base.contracts.m as unknown as ContractSnapshot;
    expect(
      outcome(() => createSnapshot({ reads: [{ name: 1 as unknown as string, snapshot: () => entry }] })),
    ).toBe('ContractDefinitionError: снимок: имя контракта пустое или не строка: 1');
    expect(
      outcome(() =>
        createSnapshot({
          reads: [
            { name: 'm', snapshot: () => entry },
            { name: 'm', snapshot: () => entry },
          ],
        }),
      ),
    ).toBe('ContractDefinitionError: m: контракт указан в снимке дважды');
    expect(
      outcome(() =>
        createSnapshot({
          reads: [
            {
              name: 'm',
              snapshot: () => {
                throw new ContractDefinitionError('свой', 'p', 'деталь');
              },
            },
          ],
        }),
      ),
    ).toBe('ContractDefinitionError: свой (p): деталь');
  });

  it('модуль снимка вернул null — отказ модуля, а не разбор null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contracts-edges-module-'));
    try {
      writeFileSync(join(dir, 'null.cjs'), 'module.exports = { snapshot: () => null };\n');
      expect(outcome(() => loadSnapshotModule('null.cjs', dir))).toBe(
        `SnapshotFormatError: ${join(dir, 'null.cjs')}: не снимок контрактов: модуль не экспортирует snapshot или default — снимок или функцию, его возвращающую`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('версии', () => {
  it.each<readonly [unknown, unknown]>([
    ['10.20.30', { major: 10, minor: 20, patch: 30 }],
    ['1.2.3', { major: 1, minor: 2, patch: 3 }],
    ['1.2', { major: 1, minor: 2, patch: 0 }],
    ['0.0.0', { major: 0, minor: 0, patch: 0 }],
    ['01.2', null],
    ['1.2.03', null],
    ['1.2.3.4', null],
    [1.2, null],
  ])('%p', (version, expected) => {
    expect(parseVersion(version)).toEqual(expected);
  });

  it('сравнение по patch — знак разности', () => {
    const [a, b] = [parseVersion('1.2.3'), parseVersion('1.2.5')];
    if (a === null || b === null) {
      throw new Error('версии фикстуры не разобраны');
    }
    expect(compareVersions(a, b)).toBeLessThan(0);
    expect(compareVersions(b, a)).toBeGreaterThan(0);
  });
});

describe('ошибки: точный текст', () => {
  it.each<readonly [string, () => Error, string]>([
    [
      'версии нет',
      () => new ContractVersionError('c', 'missing', undefined, '1.0.0'),
      'ContractVersionError: c: в payload нет версии контракта (ожидалась 1.0.0)',
    ],
    [
      'версия не разобрана',
      () => new ContractVersionError('c', 'malformed', 'x', '1.0.0'),
      'ContractVersionError: c: версия контракта не разобрана: "x" (ожидалась 1.0.0)',
    ],
    [
      'чужой мажор',
      () => new ContractVersionError('c', 'foreign-major', '2.0.0', '1.0.0'),
      'ContractVersionError: c: версия 2.0.0 — чужой мажор, читатель понимает 1.0.0',
    ],
    ['сверка без пути', () => new ShapeComparisonError('c', '', 'd'), 'ShapeComparisonError: c: d'],
    ['сверка с путём', () => new ShapeComparisonError('c', 'a.b', 'd'), 'ShapeComparisonError: c (a.b): d'],
    [
      'payload: несколько отклонений',
      () =>
        new ContractPayloadError('c', [
          { path: '', message: 'm1' },
          { path: 'a', message: 'm2' },
        ]),
      'ContractPayloadError: c: payload не соответствует контракту: (корень) — m1; a — m2',
    ],
  ])('%s', (_name, make, expected) => {
    const made = make();
    expect(`${made.name}: ${made.message}`).toBe(expected);
  });

  it('cmd.exe: путь с переводом строки — отказ снимка с путём; кавычка и % — нет', () => {
    expect(outcome(() => quoteCmdArgument('a\nb'))).toBe(
      'ContractDefinitionError: снимок (a\nb): путь с переводом строки не передать в cmd.exe — переименуйте',
    );
    expect(outcome(() => quoteCmdArgument('a"b%c%'))).toBe('^^^"a\\^^^"b^^^%c^^^%^^^"');
  });
});

describe('маршруты ↔ обработчики', () => {
  it('каждый вид расхождения — со своим кодом и текстом; дубль чужого обработчика — тоже', () => {
    const verdict = checkRoutes({
      declared: ['a', 'b', 'c', 'd'],
      handled: ['b', 'c', 'd', 'd', 'x', 'f', 'f'],
      unhandled: { b: 'r', gone: 'r' },
      foreign: { f: 'r', g: 'r', c: 'r' },
    });
    const route = (contract: string, code: string, message: string) => ({
      contract,
      code,
      path: '',
      message: `маршрут «${contract}»: ${message}`,
    });
    const stale = 'записан как чужой, а обработчика нет или маршрут свой — запись устарела';
    expect(verdict).toEqual({
      ok: false,
      violations: [
        route('a', FINDING_CODE.routeUnhandled, 'объявлен в контракте, обработчика нет'),
        route(
          'b',
          FINDING_CODE.routeUnhandled,
          'записан как необслуживаемый, а обработчик есть — запись устарела',
        ),
        route('c', FINDING_CODE.routeUndeclared, stale),
        route('d', FINDING_CODE.routeDuplicated, 'обработчиков 2'),
        route('f', FINDING_CODE.routeDuplicated, 'обработчиков 2'),
        route('g', FINDING_CODE.routeUndeclared, stale),
        route(
          'gone',
          FINDING_CODE.routeUnhandled,
          'записан как необслуживаемый, а в контракте его нет — запись устарела',
        ),
        route('x', FINDING_CODE.routeUndeclared, 'обработчик есть, в контракте маршрута нет'),
      ],
      unproven: [],
      notes: [],
    });
  });
});

describe('флаги CLI', () => {
  it.each<readonly [readonly string[], unknown]>([
    [['x'], 'Error: лишний аргумент «x»'],
    [['--nope', 'v'], 'Error: неизвестный флаг --nope'],
    [['--a'], 'Error: у флага --a нет значения'],
    [['--a', '--b', 'v'], 'Error: у флага --a нет значения'],
    [['--a', 'x--'], { a: 'x--' }],
    [['--a=v'], { a: 'v' }],
    [['--a='], 'Error: у флага --a нет значения'],
    [['--json'], { json: 'true' }],
    [['--json=1'], 'Error: флаг --json без значения, а передано «1»'],
    [['--a', '1', '--a', '2'], 'Error: флаг --a указан дважды: какое значение имелось в виду, не угадать'],
  ])('%j', (argv, expected) => {
    expect(outcome(() => parseFlags(argv, ['a', 'b'], ['json']))).toEqual(expected);
  });
});

describe('рантайм: контракт и его помощники', () => {
  it('имя контракта не строка — отказ, а не TypeError', () => {
    expect(
      outcome(() => defineContract({ name: 1 as unknown as string, version: '1.0.0', schema: z.object({}) })),
    ).toBe('ContractDefinitionError: контракт: имя контракта пустое');
  });

  it('образец с несколькими отклонениями — все через «; »', () => {
    expect(
      outcome(() =>
        defineContract({
          name: 't',
          version: '1.0.0',
          schema: z.object({ a: z.string(), b: z.number() }),
          examples: [{}],
        }),
      ),
    ).toBe(
      'ContractDefinitionError: t (examples[0]): образец не проходит схему: a — Invalid input: expected string, received undefined; b — Invalid input: expected number, received undefined',
    );
  });

  it('запись с полем вне контракта — отказ с путём и причиной; новее по минору без наблюдателя — читается', () => {
    const task = defineContract({ name: 't', version: '1.0.0', schema: z.object({ a: z.string() }) });
    expect(outcome(() => task.write({ a: 'x', x: 1 } as { a: string }))).toBe(
      'ContractPayloadError: t: payload не соответствует контракту: x — поле вне контракта: писатель не вправе его класть',
    );
    expect(outcome(() => task.read({ a: 'x', contractVersion: '1.5.0' }))).toEqual({
      data: { a: 'x' },
      version: '1.5.0',
      unknownFields: [],
      omittedUnknownFields: 0,
    });
  });

  it('mergeUnknownFields: потолок вложенности — последний допустимый и первый лишний уровень', () => {
    const nest = (depth: number): Record<string, unknown> => {
      let value: Record<string, unknown> = {};
      for (let index = 0; index < depth; index += 1) {
        value = { a: value };
      }
      return value;
    };
    expect(outcome(() => mergeUnknownFields(nest(256), nest(256)))).toEqual(nest(256));
    expect(outcome(() => mergeUnknownFields(nest(257), nest(257)))).toBe(
      `ContractPayloadError: контракт: payload не соответствует контракту: (корень) — вложенность глубже ${CONTRACT_FORMAT.MAX_SHAPE_DEPTH} уровней`,
    );
  });

  it('mergeUnknownFields: потолок вложенности считается и по массивам', () => {
    const nestArrays = (depth: number): unknown => {
      let value: unknown = {};
      for (let index = 0; index < depth; index += 1) {
        value = [value];
      }
      return value;
    };
    expect(outcome(() => mergeUnknownFields(nestArrays(256), nestArrays(256)))).toEqual(nestArrays(256));
    expect(outcome(() => mergeUnknownFields(nestArrays(257), nestArrays(257)))).toBe(
      `ContractPayloadError: контракт: payload не соответствует контракту: (корень) — вложенность глубже ${CONTRACT_FORMAT.MAX_SHAPE_DEPTH} уровней`,
    );
  });

  it('асинхронная схема — отказ контракта без пути', () => {
    const asyncTask = defineContract({
      name: 'async-task',
      version: '1.0.0',
      schema: z.object({ a: z.string() }).refine(async () => true),
    });
    expect(outcome(() => asyncTask.read({ a: 'x', contractVersion: '1.0.0' }))).toBe(
      'ContractDefinitionError: async-task: асинхронная схема (async refine/transform): разбор контракта синхронный',
    );
  });

  it('mergeUnknownFields: поля выхода сохраняются, несовпадающие формы — выход как есть', () => {
    expect(mergeUnknownFields({ a: 1, d: 2 }, { a: 1, x: 3 })).toEqual({ a: 1, d: 2, x: 3 });
    expect(mergeUnknownFields([1], { a: 1 })).toEqual([1]);
    expect(mergeUnknownFields([{}, {}], [{ x: 1 }])).toEqual([{}, {}]);
    expect(mergeUnknownFields([{}], { length: 1, 0: { x: 1 } })).toEqual([{}]);
  });

  it('findUnknownFields: поле undefined, разные длины и формы массивов — не находки', () => {
    const like = (value: unknown): object =>
      Object.assign(Object.create(Object.create(null) as object) as object, { length: 1, 0: value });
    expect(findUnknownFields({ a: 1 }, [1])).toEqual([]);
    expect(findUnknownFields({ a: undefined }, {})).toEqual([]);
    expect(findUnknownFields([{ a: 1 }, { b: 1 }], [{}])).toEqual([]);
    expect(findUnknownFields([{ a: 1 }], { 0: {} })).toEqual([]);
    expect(findUnknownFields([{ a: 1 }], { length: 1, 0: {} })).toEqual([]);
    expect(findUnknownFields(like({ a: 1 }), like({}))).toEqual([]);
    // Двойник: одинаковые длины — находка есть.
    expect(findUnknownFields([{ a: 1 }], [{}])).toEqual(['[0].a']);
  });

  it('isPlainObject и issuePath на краях', () => {
    class Box {
      readonly v = 1;
    }
    expect([undefined, 'x', new Box(), [], Object.create(null), {}].map(isPlainObject)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(issuePath(undefined)).toBe('');
    expect(issuePath([null as unknown as PropertyKey, { key: 'a' }, 0])).toBe('null.a.0');
  });

  it('notifyObserver без хука — ни вызова, ни предупреждения', () => {
    const warn = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      notifyObserver<{ readonly x: number }>(undefined, { x: 1 });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('deepFreeze: null внутри и цикл — без исключения; словари констант заморожены', () => {
    const cyclic: Record<string, unknown> = { n: null };
    cyclic.self = cyclic;
    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(Object.isFrozen(cyclic)).toBe(true);
    expect([Object.isFrozen(CONTRACT_FORMAT), Object.isFrozen(FINDING_CODE)]).toEqual([true, true]);
  });
});
