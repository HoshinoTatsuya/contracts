// biome-ignore-all lint/suspicious/noTemplateCurlyInString: исходник фикстуры содержит шаблонные строки ${…}
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Собранный пакет в проекте потребителя, где пакет `typescript` — ровно одна
 * версия, как у потребителя (5.9, 6.0, 7.0, 7.1 beta), без выбора движка
 * руками: движок выбирается по API установленного `typescript`. Код идёт в
 * настоящем Node (дочерний процесс), а не в реестре модулей jest: API TS 7 —
 * ESM, и реестр jest его не загружает, а потребитель зовёт пакет и из jest, и
 * из CLI. Итог на одних и тех же исходниках обязан совпасть между версиями.
 *
 * Нужен собранный `dist` (`pnpm test` собирает его первым).
 */
const ROOT = join(__dirname, '..', '..');
const COMPILERS: ReadonlyArray<readonly [string, string]> = [
  ['typescript', '5.9'],
  ['typescript-6', '6.0'],
  ['typescript-7', '7.0'],
  ['typescript-7-1', '7.1'],
];
const SOURCES: Readonly<Record<string, string>> = {
  'src/proto.ts': "export type Proto = 'http' | 'https';\nexport const PREFIX = 'svc';\n",
  'src/dto.ts': [
    '// кириллица до объявлений: позиции и строки — в единицах UTF-16',
    "import type { Proto } from './proto';",
    "export enum Kind { Scan = 'scan', Probe = 'probe' }",
    'interface Base { taskId: string }',
    'export interface Dto extends Base {',
    '  proto: Proto;',
    '  port?: number;',
    '  hosts: readonly { name: string; weight: number | null }[];',
    '  kind: Kind;',
    '  pair: [string, number?];',
    '  key: `lock:${string}`;',
    '  at: Date;',
    '  extra: Record<string, boolean>;',
    "  id: string & { __brand: 'Id' };",
    '  trace: string | undefined;',
    '}',
    'export type WithFn = { run: () => void };',
    '',
  ].join('\n'),
  'src/wire.ts': [
    "import { PREFIX } from './proto';",
    "import { Kind } from './dto';",
    'export const QUEUES = {',
    '  scan: `${PREFIX}:scan-tasks`,',
    '  ttl: 20 * 60_000,',
    '  kind: Kind.Probe,',
    '  lock: (id: string) => `${PREFIX}:lock:${id}`,',
    '} as const;',
    'export const BAD = { v: Math.max(1, 2) };',
    '// импорт с реэкспортом: объявление — в dto.ts',
    'export { Kind };',
    '',
  ].join('\n'),
  'src/use.ts': [
    "import { QUEUES } from './wire';",
    '// ключ «svc:scan-tasks» в комментарии — не находка',
    "const queue = 'svc:scan-tasks';",
    'export const same = queue === QUEUES.scan;',
    '',
  ].join('\n'),
};
/** Одна и та же программа для потребителя: форма, значения, снимок, отказ, поиск литералов. */
const SCRIPT = `
const { join } = require('node:path');
const t = require('@hoshinotatsuya/contracts/typescript');
const src = join(process.cwd(), 'src');
const out = {};
const run = (name, fn) => {
  try { out[name] = fn(); } catch (error) { out[name] = error.name + ': ' + error.message.split(src).join('<src>'); }
};
run('compiler', () => {
  const program = t.createProgram([join(src, 'dto.ts')]);
  program.dispose();
  return { api: program.compiler.api, version: program.compiler.version.split('.').slice(0, 2).join('.') };
});
run('shape', () => t.shapeFromTypeScript({ file: join(src, 'dto.ts'), type: 'Dto' }));
run('refusal', () => t.shapeFromTypeScript({ file: join(src, 'dto.ts'), type: 'WithFn' }));
run('wire', () => t.wireFromTypeScript({ file: join(src, 'wire.ts'), names: ['QUEUES', 'Kind'] }));
run('wireRefusal', () => t.wireFromTypeScript({ file: join(src, 'wire.ts'), names: ['BAD'] }));
run('snapshot', () =>
  t.typeScriptContract({
    name: 'scan', version: '1.2.0', file: join(src, 'dto.ts'), type: 'Dto',
    wire: { file: join(src, 'wire.ts'), names: ['QUEUES'] },
  }).snapshot('writer'));
run('literals', () => t.findWireLiterals({ root: src, values: ['svc:scan-tasks'], declaredIn: ['wire.ts'] }));
process.stdout.write(JSON.stringify(out));
`;
const OBJECT = (fields: Record<string, unknown>): unknown => ({
  kind: 'object',
  fields,
  unknownKeys: 'strip',
});
const FIELD = (shape: unknown, optional = false): unknown => ({ optional, shape });
const SHAPE = OBJECT({
  at: FIELD({ kind: 'date' }),
  extra: FIELD({ kind: 'record', key: { kind: 'string' }, value: { kind: 'boolean' } }),
  hosts: FIELD({
    kind: 'array',
    element: OBJECT({
      name: FIELD({ kind: 'string' }),
      weight: FIELD({ kind: 'union', options: [{ kind: 'null' }, { kind: 'number' }] }),
    }),
  }),
  id: FIELD({ kind: 'string' }),
  key: FIELD({ kind: 'template', pattern: '^lock:[\\s\\S]{0,}$' }),
  kind: FIELD({ kind: 'enum', values: ['probe', 'scan'] }),
  pair: FIELD({
    kind: 'tuple',
    items: [{ kind: 'string' }, { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] }],
  }),
  port: FIELD({ kind: 'number' }, true),
  proto: FIELD({ kind: 'enum', values: ['http', 'https'] }),
  taskId: FIELD({ kind: 'string' }),
  trace: FIELD({ kind: 'string' }, true),
});
const WIRE = {
  'QUEUES.scan': { type: 'string', value: 'svc:scan-tasks' },
  'QUEUES.ttl': { type: 'number', value: 1_200_000 },
  'QUEUES.kind': { type: 'string', value: 'probe' },
  'QUEUES.lock': { type: 'template', arity: 1, value: 'svc:lock:${0}' },
  'Kind.Scan': { type: 'string', value: 'scan' },
  'Kind.Probe': { type: 'string', value: 'probe' },
};
const EXPECTED = {
  shape: SHAPE,
  refusal: 'ContractDefinitionError: WithFn (run): функция в контракте: на проводе её нет',
  wire: WIRE,
  wireRefusal: 'ContractDefinitionError: wire (BAD.v): форма значения не разобрана: Math.max(1, 2)',
  snapshot: {
    role: 'writer',
    version: '1.2.0',
    versionField: null,
    legacyVersion: null,
    extraFields: 'unchecked',
    shape: SHAPE,
    wire: {
      'QUEUES.scan': WIRE['QUEUES.scan'],
      'QUEUES.ttl': WIRE['QUEUES.ttl'],
      'QUEUES.kind': WIRE['QUEUES.kind'],
      'QUEUES.lock': WIRE['QUEUES.lock'],
    },
    examples: [],
  },
  literals: { files: 3, hits: [{ file: 'use.ts', line: 3, value: 'svc:scan-tasks' }] },
};

const work = mkdtempSync(join(tmpdir(), 'contracts-installed-compiler-'));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/** Проект потребителя: собранный пакет копией (его `require('typescript')` резолвится от проекта) и `typescript` по выбору. */
const project = (name: string, typescript: (modules: string) => void): string => {
  const dir = join(work, name);
  const modules = join(dir, 'node_modules');
  const pkg = join(modules, '@hoshinotatsuya', 'contracts');
  mkdirSync(pkg, { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(pkg, 'package.json'));
  cpSync(join(ROOT, 'dist'), join(pkg, 'dist'), { recursive: true });
  for (const [file, text] of Object.entries(SOURCES)) {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  typescript(modules);
  return dir;
};
const runIn = (dir: string, script: string): { status: number | null; stdout: string; stderr: string } => {
  // NODE_PATH ставят обёртки pnpm (`node_modules/.bin/*`): с ним проект видел бы typescript пакета, а не свой.
  const { NODE_PATH: _inherited, ...env } = process.env;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env,
  });
  // Снятый сигналом процесс (таймаут) — не «пустой вывод»: причина видна в stderr сравнения.
  const killed = child.signal === null ? '' : `[снят сигналом ${child.signal}]`;
  return { status: child.status, stdout: child.stdout, stderr: `${child.stderr}${killed}` };
};

describe('собранный пакет у потребителя: движок по установленному typescript', () => {
  beforeAll(() => {
    if (!existsSync(join(ROOT, 'dist', 'typescript', 'index.js'))) {
      throw new Error('нет собранного dist: pnpm run build');
    }
  });

  it.each(COMPILERS)(
    '%s (%s): форма, значения, снимок, отказы и литералы — как в эталоне',
    (alias, version) => {
      const dir = project(alias, (modules) => {
        symlinkSync(realpathSync(join(ROOT, 'node_modules', alias)), join(modules, 'typescript'), 'dir');
      });
      const child = runIn(dir, SCRIPT);
      expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' });
      expect(JSON.parse(child.stdout)).toEqual({
        ...EXPECTED,
        compiler: { api: version.startsWith('7.') ? 'native' : 'classic', version },
      });
    },
  );

  it('typescript не установлен: подпуть загружается, вызов — отказ с причиной, а не «Cannot find module» при импорте', () => {
    const dir = project('absent', () => undefined);
    const child = runIn(
      dir,
      `const t = require('@hoshinotatsuya/contracts/typescript');
       try { const program = t.createProgram(['src/dto.ts']); process.stdout.write('собрано: ' + JSON.stringify(program.compiler)); program.dispose(); } catch (error) { process.stdout.write(error.name + ': ' + error.message); }`,
    );
    expect(child).toEqual({
      status: 0,
      stderr: '',
      stdout: expect.stringMatching(/^TypeScriptCompilerError: пакет typescript не найден/),
    });
  });

  /** `typescript` будущей версии с незнакомой формой API (так выглядел бы 7.x, снова переложивший API). */
  const futureTypeScript = (modules: string): void => {
    mkdirSync(join(modules, 'typescript'));
    writeFileSync(
      join(modules, 'typescript', 'package.json'),
      JSON.stringify({ name: 'typescript', version: '8.0.0', main: 'index.js' }),
    );
    writeFileSync(join(modules, 'typescript', 'index.js'), "exports.version = '8.0.0';\n");
  };

  it('незнакомая форма typescript и нет запасного: отказ с версией, недостающим и подсказкой, а не TypeError', () => {
    const dir = project('unknown', futureTypeScript);
    const child = runIn(
      dir,
      `const t = require('@hoshinotatsuya/contracts/typescript');
       try { const program = t.createProgram(['src/dto.ts']); process.stdout.write('собрано: ' + JSON.stringify(program.compiler)); program.dispose(); } catch (error) { process.stdout.write(error.name + ': ' + error.message); }`,
    );
    expect(child).toEqual({
      status: 0,
      stderr: '',
      stdout: expect.stringMatching(
        /^TypeScriptCompilerError: typescript 8\.0\.0 .*: форма API не узнана .*; запасной @typescript\/typescript6 тоже не годится: пакет @typescript\/typescript6 не найден .*либо @typescript\/typescript6$/,
      ),
    });
  });

  it('незнакомая форма typescript, установлен @typescript/typescript6: снимок прежним JS API — как в эталоне', () => {
    const dir = project('fallback', (modules) => {
      futureTypeScript(modules);
      mkdirSync(join(modules, '@typescript'));
      symlinkSync(
        realpathSync(join(ROOT, 'node_modules', '@typescript', 'typescript6')),
        join(modules, '@typescript', 'typescript6'),
        'dir',
      );
    });
    const child = runIn(dir, SCRIPT);
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' });
    expect(JSON.parse(child.stdout)).toEqual({ ...EXPECTED, compiler: { api: 'classic', version: '6.0' } });
  });
});
