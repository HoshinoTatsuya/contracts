// biome-ignore-all lint/suspicious/noTemplateCurlyInString: шаблоны ключей в снимке записаны с подстановками ${0}
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { parseFlags } from './cli/parse-flags';
import { compareShapes } from './compare/compare-shapes';
import { compareSnapshots } from './compare/compare-snapshots';
import { compareWire } from './compare/compare-wire';
import { validateAgainstShape } from './compare/validate-against-shape';
import { defineContract } from './runtime/define-contract';
import { regexOf } from './shape/regex-of';
import { sortedCopy } from './shape/sorted-copy';
import { assertShape } from './snapshot/assert-shape';
import { createSnapshot } from './snapshot/create-snapshot';
import { parseSnapshot } from './snapshot/parse-snapshot';
import { serializeSnapshot } from './snapshot/serialize-snapshot';
import { snapshotsEqual } from './snapshot/snapshots-equal';
import { writeSnapshot } from './snapshot/write-snapshot';
import type { ContractSnapshot } from './types/contract-snapshot.type';
import type { Shape } from './types/shape.type';
import type { SnapshotSource } from './types/snapshot-source.type';
import { findWireLiterals } from './typescript/find-wire-literals';
import { shapeFromTypeScript } from './typescript/shape-from-type-script';
import { wireFromTypeScript } from './typescript/wire-from-type-script';
import { wireFromValues } from './wire/wire-from-values';
import { formatDescriptor } from './zod/format-descriptor';
import { shapeFromZod } from './zod/shape-from-zod';

/**
 * Утверждения внешнего аудита, подтверждённые на коде: по проверке на пункт
 * (номер пункта — в имени). Неподтверждённые пункты здесь проверяются как
 * контроль, когда это возможно (например, слеши внутри шаблона).
 */
const dir = mkdtempSync(join(tmpdir(), 'contracts-external-audit-'));
// Собранный CLI: под jest `require` идёт через его загрузчик, который ESM не грузит, — проверяется настоящий Node.
const MAIN = join(__dirname, '..', 'dist', 'cli', 'main.js');
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
const outcome = (call: () => unknown): string => {
  try {
    call();
    return 'ok';
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
};
const codes = (result: {
  violations: readonly { code: string; path: string }[];
  unproven?: readonly { code: string; path: string }[];
}) => ({
  violations: result.violations.map((finding) => `${finding.code} ${finding.path}`),
  unproven: (result.unproven ?? []).map((finding) => `${finding.code} ${finding.path}`),
});
const entry: ContractSnapshot = {
  role: 'reader',
  version: '1.0.0',
  versionField: 'contractVersion',
  legacyVersion: null,
  extraFields: 'refused',
  shape: { kind: 'object', fields: {}, unknownKeys: 'strip' },
  wire: {},
  examples: [],
};

describe('внешний аудит: формат и форма zod', () => {
  it('1: служебное поле `_zod` (в том числе с циклом) в описании проверки не попадает в запись формата', () => {
    const check: Record<string, unknown> = { check: 'string_format', format: 'uuid', type: 'string' };
    check._zod = { def: check };
    expect(outcome(() => formatDescriptor(check as never))).toBe('ok');
    expect(formatDescriptor(check as never).format).toBe('uuid');
  });

  it('2, 3, 35: контроль на установленном zod — каждый встроенный формат известен; выражение или версия zod — в записи (с 0.2.0: у миноров zod выражения разные)', () => {
    const zod = z as unknown as Record<string, unknown>;
    const iso = z.iso as unknown as Record<string, unknown>;
    const made = [
      ...Object.values(zod).filter((value): value is () => unknown => typeof value === 'function'),
      ...Object.values(iso).filter((value): value is () => unknown => typeof value === 'function'),
    ].flatMap((factory) => {
      try {
        const made = factory() as unknown;
        // parseAsync и подобные без аргументов возвращают отклонённый промис: не оставлять его необработанным.
        if (made instanceof Promise) {
          made.catch(() => undefined);
        }
        const schema = made as { _zod?: { def?: { check?: unknown; format?: unknown } } };
        return schema?._zod?.def?.check === 'string_format' &&
          schema._zod.def.format !== undefined &&
          (schema._zod.def as { type?: unknown }).type === 'string'
          ? [schema]
          : [];
      } catch {
        return [];
      }
    });
    expect(made.length).toBeGreaterThanOrEqual(25);
    const bad = made
      .map((schema) => ({ format: String(schema._zod?.def?.format), shape: shapeFromZod(schema) }))
      .filter(
        ({ shape }) =>
          shape.kind !== 'string' ||
          (shape.formats ?? []).length !== 1 ||
          !(shape.formats ?? []).every((format) => format.includes('"pattern"') || format.includes('"zod"')),
      )
      .map(({ format }) => format);
    expect(bad).toEqual([]);
  });

  it('5: из двух нижних границ остаётся строгая (min(5) и gt(5) — только > 5)', () => {
    expect(shapeFromZod(z.number().min(5).pipe(z.number().gt(5)))).toEqual({
      kind: 'number',
      exclusiveMinimum: 5,
    });
    expect(shapeFromZod(z.number().gt(1).gte(2).lt(9).lte(8))).toEqual({
      kind: 'number',
      minimum: 2,
      maximum: 8,
    });
  });

  it('6: бесконечная граница — не граница, а не null в снимке', () => {
    expect(shapeFromZod(z.number().lte(Number.POSITIVE_INFINITY).pipe(z.number().gte(1)))).toEqual({
      kind: 'number',
      minimum: 1,
    });
  });

  it('7: coerce.bigint наверняка принимает bigint', () => {
    expect(shapeFromZod(z.coerce.bigint())).toEqual({
      kind: 'opaque',
      reason: 'coerce',
      upper: { kind: 'unknown' },
      lower: { kind: 'bigint' },
      semantics: 'coerce bigint {"kind":"bigint"}',
    });
  });

  it('10: min(0) — не ограничение: пересечение с тем же полем без него не отказ', () => {
    expect(
      outcome(() =>
        shapeFromZod(z.intersection(z.object({ a: z.string() }), z.object({ a: z.string().min(0) }))),
      ),
    ).toBe('ok');
  });

  it('11: асинхронная схема — отказ, а не тихий откат на внутренние флаги', () => {
    const schema = z.object({
      a: z
        .string()
        .optional()
        .refine(async () => true),
    });
    expect(outcome(() => shapeFromZod(schema, 'c'))).toMatch(
      /^ContractDefinitionError: c: асинхронная схема/,
    );
  });

  it('13: lazy, каждый раз строящий новую схему, — отказ с подсказкой про рекурсию', () => {
    const make = (): z.ZodType => z.object({ next: z.lazy(make) });
    expect(outcome(() => shapeFromZod(make(), 'c'))).toContain('рекурсия через lazy');
  });

  it('14: lazy без геттера — отказ контракта с путём, а не TypeError', () => {
    expect(outcome(() => shapeFromZod({ _zod: { def: { type: 'lazy' } } }, 'c'))).toBe(
      'ContractDefinitionError: c: lazy без функции-геттера',
    );
  });

  it('56: противоречивые границы — never', () => {
    expect(shapeFromZod(z.number().min(10).pipe(z.number().max(5)))).toEqual({ kind: 'never' });
    expect(shapeFromZod(z.string().min(5).pipe(z.string().max(3)))).toEqual({ kind: 'never' });
    expect(shapeFromZod(z.number().gt(5).lte(5))).toEqual({ kind: 'never' });
  });
});

describe('внешний аудит: разбор снимка', () => {
  const doc = (contracts: unknown): string => JSON.stringify({ format: 'contracts-snapshot/2', contracts });
  it.each([
    ['15: enum с повторами', { kind: 'enum', values: ['a', 'a'] }, 'enum с повторами строк'],
    [
      '15: ключ словаря — объект',
      {
        kind: 'record',
        key: { kind: 'object', fields: {}, unknownKeys: 'strip' },
        value: { kind: 'string' },
      },
      'ключ словаря вида «object»',
    ],
    [
      '16: rest у strip-объекта',
      { kind: 'object', fields: {}, unknownKeys: 'strip', rest: { kind: 'string' } },
      'rest у объекта с политикой strip',
    ],
  ] as const)('%s — отказ', (_name, shape, message) => {
    expect(outcome(() => assertShape(shape, 'peer', ''))).toContain(message);
  });

  it.each([
    [
      '17: лишнее поле значения на проводе',
      { q: { type: 'string', value: 'a', extra: 1 } },
      'незнакомые поля extra',
    ],
    [
      '17: значение не того вида',
      { q: { type: 'number', value: 'x' } },
      'значение не того вида для типа number',
    ],
    [
      '17: шаблон без арности',
      { q: { type: 'template', value: 'k:${0}' } },
      'значение не того вида для типа template',
    ],
  ] as const)('%s — отказ', (_name, wire, message) => {
    expect(outcome(() => parseSnapshot(doc({ m: { ...entry, wire } }), 'peer'))).toContain(message);
  });

  it('25: запись-массив — «запись не объект», а не «неизвестная роль»', () => {
    expect(outcome(() => parseSnapshot(doc({ m: [] }), 'peer'))).toContain('контракт m: запись не объект');
  });

  it('26: документ-массив — названа причина', () => {
    expect(outcome(() => parseSnapshot('[]', 'peer'))).toContain('документ — не объект, а массив');
  });
});

describe('внешний аудит: запись и сборка снимка', () => {
  const document = createSnapshot({
    reads: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({}) })],
  });

  it('20: форматтер не запускается — причина ОС, а не «код null»', () => {
    const root = join(dir, 'fmt');
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '.bin', 'biome'), 'not executable');
    chmodSync(join(root, 'node_modules', '.bin', 'biome'), 0o644);
    expect(outcome(() => writeSnapshot('s.json', document, { formatter: 'biome', cwd: root }))).toContain(
      'форматтер biome не запустился',
    );
  });

  it('21: форматтер удалил файл — отказ контракта, а не сырой ENOENT', () => {
    const file = join(dir, 'gone.json');
    expect(outcome(() => writeSnapshot(file, document, { formatter: (path) => unlinkSync(path) }))).toContain(
      'после форматтера снимок не прочитать',
    );
  });

  it('22: путь снимка — каталог: названо, что не так', () => {
    expect(outcome(() => writeSnapshot(dir, document))).toContain('путь снимка — каталог');
  });

  it('30, 32: запись источника, не прошедшая разбор, и упавший источник — отказ с именем контракта', () => {
    const broken: SnapshotSource = {
      name: 'x',
      snapshot: () => ({ ...entry, extraFields: 'maybe' }) as never,
    };
    expect(outcome(() => createSnapshot({ reads: [broken] }))).toMatch(/^ContractDefinitionError: x: /);
    const thrower: SnapshotSource = {
      name: 'y',
      snapshot: () => {
        throw new TypeError('boom');
      },
    };
    expect(outcome(() => createSnapshot({ writes: [thrower] }))).toBe(
      'ContractDefinitionError: y: запись снимка (роль writer) не собрана: boom',
    );
  });

  it('31: пустое имя источника — отказ', () => {
    expect(outcome(() => createSnapshot({ reads: [{ name: ' ', snapshot: () => entry }] }))).toContain(
      'имя контракта пустое',
    );
  });

  it('33: равенство снимков — как в JSON: -0 и 0, undefined и отсутствие поля — одно', () => {
    const base = { format: 'f', contracts: {} };
    expect(snapshotsEqual({ ...base, x: -0 } as never, { ...base, x: 0 } as never)).toBe(true);
    expect(snapshotsEqual({ ...base, x: undefined } as never, base)).toBe(true);
  });

  it('34: цикл — понятный отказ; в образце — отказ контракта', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(outcome(() => sortedCopy(cyclic))).toBe(
      'TypeError: циклическая ссылка: значение не записать в JSON',
    );
    expect(
      outcome(() =>
        defineContract({
          name: 'c',
          version: '1.0.0',
          schema: z.object({ a: z.unknown() }),
          examples: [{ a: cyclic }],
        }),
      ),
    ).toBe('ContractDefinitionError: c (examples[0]): образец не переживает JSON без потерь');
  });
});

describe('внешний аудит: сверка', () => {
  it('29: ключ wire, совпадающий с именем из прототипа, — обычный ключ', () => {
    expect(
      codes(
        compareWire(
          {},
          { constructor: { type: 'string' as const, value: 'x' } },
          { contract: 'c', mode: 'compatible' },
        ),
      ),
    ).toEqual({
      violations: ['wire-constant-missing wire:constructor'],
      unproven: [],
    });
  });

  it('40: метка-литерал (число, булево) и несколько значений метки у писателя — по варианту на значение', () => {
    const reader = z.discriminatedUnion('status', [
      z.object({ status: z.literal(200), body: z.string() }),
      z.object({ status: z.literal(400), error: z.string().optional() }),
    ]);
    const writer = z.object({ status: z.union([z.literal(200), z.literal(400)]), body: z.string() });
    expect(
      codes(compareShapes(shapeFromZod(writer), shapeFromZod(reader), { contract: 'c', mode: 'compatible' })),
    ).toEqual({
      violations: [],
      unproven: [],
    });
    const strings = z.discriminatedUnion('t', [
      z.object({ t: z.literal('a'), v: z.string() }),
      z.object({ t: z.literal('b'), v: z.string() }),
    ]);
    expect(
      codes(
        compareShapes(
          shapeFromZod(z.object({ t: z.enum(['a', 'b']), v: z.string() })),
          shapeFromZod(strings),
          { contract: 'c', mode: 'compatible' },
        ),
      ),
    ).toEqual({ violations: [], unproven: [] });
    const flags = z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), v: z.string() }),
      z.object({ ok: z.literal(false) }),
    ]);
    expect(
      codes(
        compareShapes(shapeFromZod(z.object({ ok: z.boolean(), v: z.string() })), shapeFromZod(flags), {
          contract: 'c',
          mode: 'compatible',
        }),
      ),
    ).toEqual({ violations: [], unproven: [] });
    // Контроль: значение метки, которого читатель не знает, — по-прежнему нарушение.
    expect(
      codes(
        compareShapes(
          shapeFromZod(z.object({ status: z.union([z.literal(200), z.literal(500)]), body: z.string() })),
          shapeFromZod(reader),
          {
            contract: 'c',
            mode: 'compatible',
          },
        ),
      ).violations.length,
    ).toBeGreaterThan(0);
  });

  it('41: строки писателя против формата читателя — проверяются его выражением; формат с функцией — «не доказано»', () => {
    const check = (writer: z.ZodType, reader: z.ZodType) =>
      codes(compareShapes(shapeFromZod(writer), shapeFromZod(reader), { contract: 'c', mode: 'compatible' }));
    expect(check(z.enum(['00000000-0000-0000-0000-000000000000']), z.uuid())).toEqual({
      violations: [],
      unproven: [],
    });
    expect(check(z.enum(['https://a.example']), z.url())).toEqual({
      violations: [],
      unproven: ['not-proven '],
    });
  });

  it('53: кратность дробям — без ошибки IEEE 754', () => {
    expect(
      codes(
        compareShapes(
          { kind: 'number', multipleOf: 0.3 },
          { kind: 'number', multipleOf: 0.1 },
          { contract: 'c', mode: 'compatible' },
        ),
      ),
    ).toEqual({ violations: [], unproven: [] });
    expect(validateAgainstShape(0.3, { kind: 'number', multipleOf: 0.1 })).toEqual([]);
    expect(
      codes(
        compareShapes(
          { kind: 'literal', value: 0.3 },
          { kind: 'number', multipleOf: 0.1 },
          { contract: 'c', mode: 'compatible' },
        ),
      ),
    ).toEqual({ violations: [], unproven: [] });
  });

  it('53 (тот же класс): несколько multipleOf одной схемы — без ошибки IEEE 754', () => {
    expect(shapeFromZod(z.number().multipleOf(0.1).multipleOf(0.3))).toEqual({
      kind: 'number',
      multipleOf: 0.3,
    });
    expect(shapeFromZod(z.number().multipleOf(0.3).multipleOf(0.1))).toEqual({
      kind: 'number',
      multipleOf: 0.3,
    });
  });

  it('класс версий: зеркало сравнивает разобранные версии — 1.2 и 1.2.0 одна', () => {
    const copy = (version: string) =>
      createSnapshot({ both: [defineContract({ name: 'm', version, schema: z.object({ a: z.string() }) })] });
    expect(compareSnapshots(copy('1.2'), copy('1.2.0'), { mode: 'mirror' }).violations).toEqual([]);
    expect(
      compareSnapshots(copy('1.2.0'), copy('1.3.0'), { mode: 'mirror' }).violations.map((f) => f.code),
    ).toEqual(['mirror-difference']);
  });

  it('54: читатель без поля версии — замечание; строгий — нарушение', () => {
    const writer = createSnapshot({
      writes: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({ a: z.string() }) })],
    });
    const loose = {
      format: writer.format,
      contracts: { m: { ...entry, versionField: null, shape: shapeFromZod(z.object({ a: z.string() })) } },
    };
    const strict = {
      format: writer.format,
      contracts: {
        m: { ...entry, versionField: null, shape: shapeFromZod(z.strictObject({ a: z.string() })) },
      },
    };
    const lax = compareSnapshots(writer, loose);
    expect([lax.ok, lax.notes.map((note) => note.code)]).toEqual([true, ['version-field-mismatch']]);
    // Поле версии — часть формы писателя: строгий читатель отвергнет его как лишнее поле.
    expect(codes(compareSnapshots(writer, strict)).violations).toEqual(['field-rejected contractVersion']);
  });

  it('52: контроль — шаблон со слешами внутри разбирается и проверяет', () => {
    expect(regexOf('/^\\d{2}\\/\\d{2}$/')?.test('12/34')).toBe(true);
    expect(regexOf('/a/b/i')?.flags).toBe('i');
    expect(outcome(() => assertShape({ kind: 'string', patterns: ['/^https?:\\/\\/x$/'] }, 'peer', ''))).toBe(
      'ok',
    );
  });

  it('55: контроль — поле версии `__proto__` остаётся полем и доезжает', () => {
    const contract = defineContract({
      name: 'p',
      version: '1.0.0',
      schema: z.object({ a: z.string() }),
      versionField: '__proto__',
    });
    const wire = JSON.parse(JSON.stringify(contract.write({ a: 'x' }))) as unknown;
    expect(contract.read(wire).version).toBe('1.0.0');
  });
});

describe('внешний аудит: значения на проводе и TypeScript', () => {
  it('43: построитель с параметром по умолчанию или rest — отказ', () => {
    expect(outcome(() => wireFromValues({ key: (id = 'x') => `k:${id}` }))).toContain(
      'параметр по умолчанию или rest',
    );
    expect(outcome(() => wireFromValues({ key: (...ids: string[]) => ids.join(':') }))).toContain(
      'параметр по умолчанию или rest',
    );
  });

  it('44: построитель, упавший на подстановках, — отказ контракта', () => {
    expect(outcome(() => wireFromValues({ key: (id: number) => `k:${id.toFixed(0)}` }, 'c'))).toMatch(
      /^ContractDefinitionError: c \(wire:key\): построитель ключа упал/,
    );
  });

  it('42: файл объявления не просматривается', () => {
    const root = join(dir, 'literals');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'contract.ts'), "export const Q = 'scan-tasks';\n");
    writeFileSync(join(root, 'use.ts'), "queue.add('scan-tasks');\n");
    const scan = findWireLiterals({ root, values: ['scan-tasks'], declaredIn: ['contract.ts'] } as Parameters<
      typeof findWireLiterals
    >[0]);
    expect([scan.files, scan.hits.map((hit) => hit.file)]).toEqual([1, ['use.ts']]);
  });

  it('46: рекурсивное объединение — отказ «рекурсивный тип»', () => {
    writeFileSync(join(dir, 'json.ts'), 'export type Json = string | number | Json[];\n');
    expect(outcome(() => shapeFromTypeScript({ file: join(dir, 'json.ts'), type: 'Json' }))).toContain(
      'рекурсивный тип',
    );
  });

  it('47, 48: реэкспорт и объявление функции-построителя находятся', () => {
    writeFileSync(
      join(dir, 'dto.ts'),
      'export interface Dto { a: string }\nexport function lockKey(id: string) { return `lock:${id}`; }\n',
    );
    writeFileSync(join(dir, 'barrel.ts'), "export { Dto, lockKey } from './dto';\n");
    expect(shapeFromTypeScript({ file: join(dir, 'barrel.ts'), type: 'Dto' })).toEqual({
      kind: 'object',
      unknownKeys: 'strip',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
    });
    expect(wireFromTypeScript({ file: join(dir, 'barrel.ts'), names: ['lockKey'] })).toEqual({
      lockKey: { type: 'template', arity: 1, value: 'lock:${0}' },
    });
  });
});

describe('внешний аудит: CLI', () => {
  it('51: `--ключ=значение`', () => {
    expect(parseFlags(['--mode=mirror', '--json'], ['mode'], ['json'])).toEqual({
      mode: 'mirror',
      json: 'true',
    });
    expect(outcome(() => parseFlags(['--mode='], ['mode']))).toContain('нет значения');
    expect(outcome(() => parseFlags(['--json=1'], [], ['json']))).toContain('без значения');
  });

  it('39: контроль — модуль снимка в ESM (.mjs) грузится собранным CLI на Node 24', () => {
    const shape: Shape = { kind: 'object', fields: {}, unknownKeys: 'strip' };
    const doc = serializeSnapshot({
      format: 'contracts-snapshot/2',
      contracts: { m: { ...entry, shape } },
    });
    writeFileSync(join(dir, 'snap.mjs'), `export const snapshot = () => (${doc});\n`);
    const run = spawnSync(process.execPath, [MAIN, 'snapshot', '--from', 'snap.mjs', '--out', 'snap.json'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect([run.status, run.stdout, run.stderr]).toEqual([
      0,
      'снимок записан: snap.json (контрактов 1)\n',
      '',
    ]);
    const legacy = (value: string) =>
      createSnapshot({
        reads: [
          defineContract({
            name: 'm',
            version: '1.2.0',
            legacyVersion: value,
            schema: z.object({ a: z.string() }),
          }),
        ],
      });
    expect(compareSnapshots(legacy('1.0'), legacy('1.0.0'), { mode: 'mirror' }).violations).toEqual([]);
    expect(compareSnapshots(legacy('1.0.0'), legacy('1.1.0'), { mode: 'mirror' }).violations.length).toBe(1);
  });
});
