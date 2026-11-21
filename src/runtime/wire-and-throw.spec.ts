import { z } from 'zod';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import type { ContractPayloadError } from '../errors/contract-payload.error';
import { runSource } from '../testing/run-source';
import { defineContract } from './define-contract';

/**
 * Рантайм контракта: что уходит на провод и что бывает, когда схема бросает.
 *
 * - Исключение схемы (`JSON.parse` в `transform`, `new URL` в `refine`,
 *   дискриминатор через `lazy`) zod превращает в ОТКЛОНЁННЫЙ Promise из
 *   `~standard.validate`. Он обязан получить обработчик: иначе процесс падает
 *   с кодом 1, хотя вызывающий поймал отказ. Поэтому — отдельный процесс и его
 *   код выхода, а не исход внутри jest.
 * - `write()` проверяет то, что реально уйдёт по JSON (экземпляр класса,
 *   `toJSON`, `transform`, меняющий длину), и сверяет поля с ФОРМОЙ контракта,
 *   а не с выходом разбора (вариант-подмножество объединения, `transform`,
 *   убирающий ключ, — не «поля вне контракта»).
 */
const errorOf = (action: () => unknown): Error => {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error('ожидался отказ');
};

describe('исключение схемы не роняет процесс (отдельный процесс, код выхода)', () => {
  const survives = (body: string): { readonly status: number | null; readonly out: string } => {
    const run = runSource(`
let out = [];
process.on('exit', (code) => { process.stdout.write(out.join('\\n') + '\\nexit=' + code); });
${body}
setTimeout(() => out.push('alive'), 50);
`);
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  };

  it('read: transform бросил на payload — ContractPayloadError с причиной, процесс жив', () => {
    const run = survives(`
const R = lib.defineContract({ name: 'evt', version: '1.0.0', schema: z.object({ data: z.string().transform((s) => JSON.parse(s)) }) });
try { R.read({ contractVersion: '1.0.0', data: '{bad' }); out.push('read ok?!'); }
catch (e) { out.push(e.name + '|' + (e.cause && e.cause.name) + '|' + /исключение/.test(e.message)); }
`);
    expect(run.out).toContain('ContractPayloadError|SyntaxError|true');
    expect(run.out).toContain('alive');
    expect(run.status).toBe(0);
  });

  it('write: refine бросил (new URL) — ContractPayloadError, процесс жив', () => {
    const run = survives(`
const W = lib.defineContract({ name: 'w', version: '1.0.0', schema: z.object({ url: z.string().refine((s) => new URL(s).protocol === 'https:') }) });
try { W.write({ url: 'not a url' }); out.push('write ok?!'); }
catch (e) { out.push(e.name + '|' + (e.cause && e.cause.name)); }
`);
    expect(run.out).toContain('ContractPayloadError|TypeError');
    expect(run.out).toContain('alive');
    expect(run.status).toBe(0);
  });

  it('defineContract: образец, на котором схема бросает, — ContractDefinitionError, процесс жив', () => {
    const run = survives(`
try {
  lib.defineContract({ name: 'e', version: '1.0.0', schema: z.object({ data: z.string().transform((s) => JSON.parse(s)) }), examples: [{ data: '{bad' }] });
  out.push('defined?!');
} catch (e) { out.push(e.name + '|' + /examples\\[0\\]/.test(e.message)); }
`);
    expect(run.out).toContain('ContractDefinitionError|true');
    expect(run.out).toContain('alive');
    expect(run.status).toBe(0);
  });

  it('гейт runtime: схема читателя бросает на образце писателя — находка example-rejected, процесс жив', () => {
    const run = survives(`
const nodeFs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'contracts-throw-'));
const W = lib.defineContract({ name: 'c', version: '1.0.0', schema: z.object({ data: z.string() }), examples: [{ data: '{bad' }] });
const R = lib.defineContract({ name: 'c', version: '1.0.0', schema: z.object({ data: z.string().transform((s) => JSON.parse(s)) }) });
nodeFs.writeFileSync(path.join(dir, 'peer.json'), lib.serializeSnapshot(lib.createSnapshot({ writes: [W] })));
const snapshot = () => lib.createSnapshot({ reads: [R] });
nodeFs.writeFileSync(path.join(dir, 'mine.json'), lib.serializeSnapshot(snapshot()));
const { checks } = lib.gateChecks({ root: dir, snapshot, committed: 'mine.json', minContracts: 1, runtime: [R], peers: [{ name: 'p', source: { kind: 'file', path: 'peer.json' } }] });
for (const c of checks) { try { c.run(); out.push('PASS ' + c.name); } catch (e) { out.push('FAIL ' + c.name + ' :: ' + (/example-rejected/.test(e.message) && /SyntaxError/.test(e.message))); } }
nodeFs.rmSync(dir, { recursive: true, force: true });
`);
    expect(run.out).toContain(
      'FAIL p: совместимость (compatible): нарушений вне известных расхождений нет :: true',
    );
    expect(run.out).toContain('alive');
    expect(run.status).toBe(0);
  });

  it('дискриминатор через lazy (zod бросает на каждом разборе) — отказ чтения, процесс жив', () => {
    const run = survives(`
let R;
try {
  R = lib.defineContract({ name: 'du', version: '1.0.0', versionField: null, schema: z.discriminatedUnion('k', [z.object({ k: z.literal('p') }), z.object({ k: z.lazy(() => z.literal('q')) })]) });
  out.push('defined');
} catch (e) { out.push('definition ' + e.name); }
if (R) { try { R.read({ k: 'q' }); out.push('read ok'); } catch (e) { out.push('read ' + e.name); } }
`);
    // Такой читатель не разбирает ничего: отказ при объявлении, а не «совместимо» в снимке.
    expect(run.out).toContain('definition ContractDefinitionError');
    expect(run.out).toContain('alive');
    expect(run.status).toBe(0);
  });

  it('снимок формы: поле, бросающее на undefined, — обязательное, процесс жив', () => {
    const run = survives(`
const shape = lib.shapeFromZod(z.object({ a: z.unknown().transform(() => { throw new Error('x'); }), b: z.string().optional() }));
out.push(JSON.stringify([shape.fields.a.optional, shape.fields.b.optional]));
`);
    expect(run.out).toContain('[false,true]');
    expect(run.out).toContain('alive');
    expect(run.status).toBe(0);
  });

  it('асинхронная схема — по-прежнему ContractDefinitionError, а не «отклонение payload»', () => {
    const contract = defineContract({
      name: 'a',
      version: '1.0.0',
      versionField: null,
      schema: z.object({ id: z.string() }).refine(async () => true),
    });
    expect(errorOf(() => contract.read({ id: 'x' }))).toBeInstanceOf(ContractDefinitionError);
  });
});

describe('write: на провод — то, что уйдёт по JSON, и поля сверяются с формой контракта', () => {
  const W = defineContract({
    name: 'c',
    version: '1.0.0',
    schema: z.object({ a: z.number(), n: z.object({ x: z.string() }).optional() }),
  });
  class Dto {
    public a = 1;
    public secret = 's3cr3t';
  }
  class Inner {
    public x = 'v';
    public token = 't';
  }
  class Weird {
    public x = 'v';
    public toJSON(): unknown {
      return { x: 'v', injected: true };
    }
  }
  const pathsOf = (action: () => unknown): string[] =>
    (errorOf(action) as ContractPayloadError).issues.map((issue) => issue.path);

  it('экземпляр класса в корне и внутри, toJSON — отказ по полю, которое уйдёт на провод', () => {
    expect(pathsOf(() => W.write(new Dto() as never))).toEqual(['secret']);
    expect(pathsOf(() => W.write({ a: 1, n: new Inner() } as never))).toEqual(['n.token']);
    expect(pathsOf(() => W.write({ a: 1, n: new Weird() } as never))).toEqual(['n.injected']);
    expect(
      pathsOf(() => W.write({ a: 1, n: { x: 'v', toJSON: () => ({ x: 'v', z: 1 }) } } as never)),
    ).toEqual(['n.z']);
  });

  it('возвращает JSON-копию: экземпляр класса без лишнего — простой объект с версией', () => {
    class Clean {
      public a = 2;
    }
    const wire = W.write(new Clean() as never);
    expect(Object.getPrototypeOf(wire)).toBe(Object.prototype);
    expect(wire).toEqual({ a: 2, contractVersion: '1.0.0' });
  });

  it('transform массива, меняющий длину, не прячет лишние поля', () => {
    const contract = defineContract({
      name: 't',
      version: '1.0.0',
      versionField: null,
      schema: z.object({
        items: z.array(z.object({ x: z.string() })).transform((items) => items.slice(0, 1)),
      }),
    });
    expect(pathsOf(() => contract.write({ items: [{ x: 'a' }, { x: 'b', secret: 1 }] } as never))).toEqual([
      'items[1].secret',
    ]);
    expect(contract.write({ items: [{ x: 'a' }, { x: 'b' }] })).toEqual({ items: [{ x: 'a' }, { x: 'b' }] });
  });

  it('форма о полях не говорит (preprocess в корне) — сверка с выходом; несопоставимое — отказ «не доказано»', () => {
    const plain = defineContract({
      name: 'p',
      version: '1.0.0',
      versionField: null,
      schema: z.preprocess((value) => value, z.object({ a: z.string() })),
    });
    expect(pathsOf(() => plain.write({ a: 'x', extra: 1 } as never))).toEqual(['extra']);
    expect(plain.write({ a: 'x' } as never)).toEqual({ a: 'x' });
    const reshaped = defineContract({
      name: 'r',
      version: '1.0.0',
      versionField: null,
      schema: z.preprocess(
        (value) => (Array.isArray(value) ? { a: value[0] } : value),
        z.object({ a: z.string() }),
      ),
    });
    const error = errorOf(() => reshaped.write(['x'] as never)) as ContractPayloadError;
    expect(error.issues.map((issue) => [issue.path, /не доказано/.test(issue.message)])).toEqual([
      ['', true],
    ]);
  });

  it('после JSON схема обязана принять то же: Date под z.date() и bigint — отказ, а не тихая порча', () => {
    const dated = defineContract({ name: 'd', version: '1.0.0', schema: z.object({ at: z.date() }) });
    const error = errorOf(() => dated.write({ at: new Date(0) })) as ContractPayloadError;
    expect(error.issues.map((issue) => [issue.path, /после JSON/.test(issue.message)])).toEqual([
      ['at', true],
    ]);
    const big = defineContract({ name: 'b', version: '1.0.0', schema: z.object({ n: z.bigint() }) });
    expect((errorOf(() => big.write({ n: 1n })) as ContractPayloadError).issues[0]?.message).toMatch(
      /не переносится JSON/,
    );
  });

  it('вариант-подмножество объединения и transform, убирающий ключ, — не «поля вне контракта»', () => {
    const union = defineContract({
      name: 'u',
      version: '1.0.0',
      versionField: null,
      schema: z.object({
        ev: z.union([z.object({ kind: z.string() }), z.object({ kind: z.string(), detail: z.string() })]),
      }),
    });
    expect(union.write({ ev: { kind: 'a', detail: 'd' } } as never)).toEqual({
      ev: { kind: 'a', detail: 'd' },
    });
    expect(pathsOf(() => union.write({ ev: { kind: 'a', other: 'd' } } as never))).toEqual(['ev.other']);
    const dropped = defineContract({
      name: 'd',
      version: '1.0.0',
      versionField: null,
      schema: z
        .object({ a: z.string(), legacy: z.string().optional() })
        .transform(({ legacy: _legacy, ...rest }) => rest),
    });
    expect(dropped.write({ a: 'x', legacy: 'y' })).toEqual({ a: 'x', legacy: 'y' });
  });

  it('вариант выбирается с учётом формата: поле, которое принимает только вариант-«пустой объект», — вне контракта', () => {
    const contract = defineContract({
      name: 'f',
      version: '1.0.0',
      versionField: null,
      schema: z.object({ c: z.union([z.record(z.string(), z.uuid()), z.object({})]) }),
    });
    expect(pathsOf(() => contract.write({ c: { c: 'x1' } } as never))).toEqual(['c.c']);
    expect(contract.write({ c: { c: '00000000-0000-0000-0000-000000000000' } } as never)).toEqual({
      c: { c: '00000000-0000-0000-0000-000000000000' },
    });
  });
});

describe('read: неизвестное — то, чего не объявляет форма, а не то, что переименовал transform', () => {
  it('поле, прочитанное и переименованное transform, — не сигнал наблюдателя и не возвращается при keep', () => {
    const seen: string[][] = [];
    const schema = z.object({ a: z.number() }).transform(({ a }) => ({ b: a }));
    const strip = defineContract({
      name: 'r',
      version: '1.0.0',
      versionField: null,
      schema,
      observer: { unknownFields: (event) => seen.push([...event.paths]) },
    });
    expect(strip.read({ a: 1 })).toEqual({
      data: { b: 1 },
      version: '1.0.0',
      unknownFields: [],
      omittedUnknownFields: 0,
    });
    const keep = defineContract({
      name: 'r',
      version: '1.0.0',
      versionField: null,
      schema,
      unknownFields: 'keep',
      observer: { unknownFields: (event) => seen.push([...event.paths]) },
    });
    expect(keep.read({ a: 1, extra: 2 }).data).toEqual({ b: 1, extra: 2 });
    expect(seen).toEqual([['extra']]);
  });
});

describe('образцы: не переживший JSON — отказ с этой причиной', () => {
  it('bigint и undefined в массиве', () => {
    expect(
      errorOf(() =>
        defineContract({
          name: 'b',
          version: '1.0.0',
          schema: z.object({ n: z.bigint() }),
          examples: [{ n: 1n }],
        }),
      ).message,
    ).toMatch(/examples\[0\].*не переживает JSON/);
    expect(
      errorOf(() =>
        defineContract({
          name: 'u',
          version: '1.0.0',
          schema: z.object({ a: z.array(z.string().optional()) }),
          examples: [{ a: ['x', undefined] }],
        }),
      ).message,
    ).toMatch(/examples\[0\].*не переживает JSON/);
  });

  it('образец с полем вне формы — отказ (write() его бы не выпустил)', () => {
    expect(
      errorOf(() =>
        defineContract({
          name: 'x',
          version: '1.0.0',
          schema: z.object({ a: z.number() }),
          examples: [{ a: 1, z: 2 }],
        }),
      ).message,
    ).toMatch(/examples\[0\].*z — поле вне контракта/);
  });
});
