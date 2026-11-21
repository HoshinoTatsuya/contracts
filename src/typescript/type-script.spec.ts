import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { diffShapes } from '../compare/diff-shapes';
import { ContractDefinitionError } from '../errors/contract-definition.error';
import { wireFromValues } from '../wire/wire-from-values';
import { shapeFromZod } from '../zod/shape-from-zod';
import { findWireLiterals } from './find-wire-literals';
import { shapeFromTypeScript } from './shape-from-type-script';
import { COMPILERS } from './testing/compilers.fixture';
import { typeScriptContract } from './type-script-contract';
import { wireFromTypeScript } from './wire-from-type-script';

const dir = mkdtempSync(join(tmpdir(), 'contracts-ts-spec-'));
const write = (name: string, text: string): string => {
  writeFileSync(join(dir, name), text);
  return join(dir, name);
};

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const TYPES = write(
  'job.interface.ts',
  `
import type { Proto } from './proto.type';
export type Proto2 = Proto;
interface Base { taskId: string }
export interface IJob extends Base {
  proto: Proto2;
  port: number;
  hosts: Array<{ name: string; weight?: number }>;
  meta?: { code: number | null };
  // перенос строки и запись через псевдоним на форму не влияют
  mode:
    | 'ip'
    | 'domain';
  trace: string | undefined;
}
export type PickedJob = Pick<IJob, 'taskId' | 'port'>;
export interface IOpen { known: string; [extra: string]: string }
export type Dict = Record<string, number>;
export interface ITree { children: ITree[] }
export interface IWithMethod { run(): void }
export enum Source { Api = 'api', Cron = 'cron' }
export interface IWithEnum { source: Source; tuple: [string, number?]; when: Date; key: \`lock:\${string}\`; id: string & { __brand: 'Id' } }
`,
);
write('proto.type.ts', `export type Proto = 'http' | 'https';\n`);

describe.each(COMPILERS)('форма по типам TypeScript — %s (%s)', (compiler) => {
  it('интерфейс совпадает по форме с равнозначной схемой Zod (зеркало зелёное)', () => {
    const zod = z.object({
      taskId: z.string(),
      proto: z.enum(['http', 'https']),
      port: z.number(),
      hosts: z.array(z.object({ name: z.string(), weight: z.number().optional() })),
      meta: z.object({ code: z.number().nullable() }).optional(),
      mode: z.enum(['domain', 'ip']),
      trace: z.string().optional(),
    });
    expect(
      diffShapes(shapeFromTypeScript({ compiler, file: TYPES, type: 'IJob' }), shapeFromZod(zod), {
        contract: 'job',
      }),
    ).toEqual([]);
  });

  it('разошедшаяся копия — различие с путём', () => {
    const zod = z.object({ taskId: z.string(), port: z.string() });
    expect(
      diffShapes(shapeFromTypeScript({ compiler, file: TYPES, type: 'PickedJob' }), shapeFromZod(zod), {
        contract: 'job',
      }).map((finding) => finding.path),
    ).toEqual(['port']);
  });

  it('индексная сигнатура — открытый объект, без свойств — словарь', () => {
    expect(shapeFromTypeScript({ compiler, file: TYPES, type: 'IOpen' })).toEqual({
      kind: 'object',
      unknownKeys: 'keep',
      rest: { kind: 'string' },
      fields: { known: { optional: false, shape: { kind: 'string' } } },
    });
    expect(shapeFromTypeScript({ compiler, file: TYPES, type: 'Dict' })).toEqual({
      kind: 'record',
      key: { kind: 'string' },
      value: { kind: 'number' },
    });
  });

  it('enum, кортеж с необязательным, дата, шаблонный тип, брендированная строка', () => {
    const shape = shapeFromTypeScript({ compiler, file: TYPES, type: 'IWithEnum' });
    expect(shape).toEqual({
      kind: 'object',
      unknownKeys: 'strip',
      fields: {
        id: { optional: false, shape: { kind: 'string' } },
        key: { optional: false, shape: { kind: 'template', pattern: '^lock:[\\s\\S]{0,}$' } },
        source: { optional: false, shape: { kind: 'enum', values: ['api', 'cron'] } },
        tuple: {
          optional: false,
          shape: {
            kind: 'tuple',
            items: [
              { kind: 'string' },
              { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] },
            ],
          },
        },
        when: { optional: false, shape: { kind: 'date' } },
      },
    });
    // Шаблонный тип TypeScript и z.templateLiteral — одна форма.
    expect((shape.kind === 'object' && shape.fields.key?.shape) || null).toEqual(
      shapeFromZod(z.templateLiteral(['lock:', z.string()])),
    );
  });

  it('рекурсия, метод, неизвестное имя — отказ', () => {
    expect(() => shapeFromTypeScript({ compiler, file: TYPES, type: 'ITree' })).toThrow('рекурсивный тип');
    expect(() => shapeFromTypeScript({ compiler, file: TYPES, type: 'IWithMethod' })).toThrow(
      ContractDefinitionError,
    );
    expect(() => shapeFromTypeScript({ compiler, file: TYPES, type: 'INope' })).toThrow(
      'объявление не найдено',
    );
  });
});

const CONSTANTS = write(
  'queues.constant.ts',
  `
import { PREFIX } from './prefix.constant';
const MINUTE = 60_000;
export enum Route { Begin = 'begin', Done = 'done' }
export const QUEUES = Object.freeze({
  tasks: \`\${PREFIX}:tasks\`,
  results: PREFIX + ':results',
  lockMs: 20 * MINUTE + 5 * 1_000,
  enabled: true,
  route: Route.Begin,
  lockKey: (taskId: string, host: string) => \`\${PREFIX}:lock:\${taskId}:\${host}\`,
  nested: { list: ['a', 'b'] },
} as const);
export const BAD = { computed: Math.max(1, 2) };
`,
);
write('prefix.constant.ts', `export const PREFIX = 'scan';\n`);

describe.each(COMPILERS)('значения на проводе по исходнику TypeScript — %s (%s)', (compiler) => {
  it('константы вычисляются, импорт и enum разрешаются, построитель ключа — шаблон', () => {
    expect(wireFromTypeScript({ compiler, file: CONSTANTS, names: ['QUEUES', 'Route'] })).toEqual({
      'QUEUES.tasks': { type: 'string', value: 'scan:tasks' },
      'QUEUES.results': { type: 'string', value: 'scan:results' },
      'QUEUES.lockMs': { type: 'number', value: 1_205_000 },
      'QUEUES.enabled': { type: 'boolean', value: true },
      'QUEUES.route': { type: 'string', value: 'begin' },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: подстановка построителя ключа в снимке — буквальный текст
      'QUEUES.lockKey': { type: 'template', arity: 2, value: 'scan:lock:${0}:${1}' },
      'QUEUES.nested.list[0]': { type: 'string', value: 'a' },
      'QUEUES.nested.list[1]': { type: 'string', value: 'b' },
      'Route.Begin': { type: 'string', value: 'begin' },
      'Route.Done': { type: 'string', value: 'done' },
    });
  });

  it('совпадает со снятием тех же значений на рантайме', () => {
    const runtime = wireFromValues({
      QUEUES: {
        tasks: 'scan:tasks',
        results: 'scan:results',
        lockMs: 1_205_000,
        enabled: true,
        route: 'begin',
        lockKey: (taskId: string, host: string) => `scan:lock:${taskId}:${host}`,
        nested: { list: ['a', 'b'] },
      },
    });
    expect(wireFromTypeScript({ compiler, file: CONSTANTS, names: ['QUEUES'] })).toEqual(runtime);
  });

  it('неразобранная форма (вызов) — отказ, а не пропуск', () => {
    expect(() => wireFromTypeScript({ compiler, file: CONSTANTS, names: ['BAD'] })).toThrow('Math.max');
  });

  it('typeScriptContract собирает запись снимка', () => {
    const source = typeScriptContract({
      compiler,
      name: 'job',
      version: '1.0.0',
      file: TYPES,
      type: 'PickedJob',
      wire: { file: CONSTANTS, names: ['Route'] },
    });
    expect(source.snapshot('reader')).toEqual({
      role: 'reader',
      version: '1.0.0',
      versionField: null,
      legacyVersion: null,
      extraFields: 'unchecked',
      shape: {
        kind: 'object',
        unknownKeys: 'strip',
        fields: {
          port: { optional: false, shape: { kind: 'number' } },
          taskId: { optional: false, shape: { kind: 'string' } },
        },
      },
      wire: {
        'Route.Begin': { type: 'string', value: 'begin' },
        'Route.Done': { type: 'string', value: 'done' },
      },
      examples: [],
    });
  });
});

describe.each(COMPILERS)('литералы провода в коде — %s (%s)', (compiler) => {
  it('находит строковый литерал значения, но не комментарий и не путь импорта', () => {
    const root = mkdtempSync(join(tmpdir(), 'contracts-literals-'));
    try {
      writeFileSync(
        join(root, 'a.ts'),
        `import x from 'scan:tasks';\n// 'scan:tasks' в комментарии\nexport const q = 'scan:tasks';\n`,
      );
      writeFileSync(join(root, 'b.ts'), `export const ok = QUEUES.tasks;\n`);
      expect(findWireLiterals({ compiler, root, values: ['scan:tasks', ''] })).toEqual({
        files: 2,
        hits: [{ file: 'a.ts', line: 3, value: 'scan:tasks' }],
      });
      expect(
        findWireLiterals({ compiler, root, values: ['scan:tasks'], include: (file) => file !== 'a.ts' }),
      ).toEqual({
        files: 1,
        hits: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
