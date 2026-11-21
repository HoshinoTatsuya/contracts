// biome-ignore-all lint/suspicious/noTemplateCurlyInString: шаблоны ключей в снимке записаны с подстановками ${0}
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TypeScriptProgram } from '../types/type-script-program.type';
import { createProgram } from './create-program';
import { COMPILERS } from './testing/compilers.fixture';
import { wireFromTypeScript } from './wire-from-type-script';

/**
 * «Золотая» таблица: точный итог (код, путь, ТЕКСТ) на каждый случай. Ожидания записаны
 * генератором с собранного пакета и прочитаны глазами; изменение поведения или текста находки
 * обязано менять эту таблицу осознанно.
 */
const FILES: Readonly<Record<string, string>> = {
  'base.ts': "export const PREFIX = 'svc';\nexport enum Kind { A = 'a', B = 2 }\n",
  'wire.ts':
    "import { PREFIX, Kind } from './base';\nconst LOCAL = 'loc';\nlet MUTABLE = 1;\nexport const SCALARS = { s: 'x', n: 1_000, neg: -5, pos: +3, t: true, f: false, z: null, tpl: `${PREFIX}:q`, nst: `plain` };\nexport const MATH = { add: 1 + 2, sub: 5 - 2, mul: 20 * 60_000, div: 9 / 3, mod: 7 % 4, pow: 2 ** 10, cat: 'a' + 1, cat2: 1 + 'b' };\nexport const REFS = { local: LOCAL, imported: PREFIX, member: Kind.A, numeric: Kind.B, wrapped: (LOCAL as string)!, frozen: Object.freeze({ x: 1 }), sat: { y: 2 } satisfies { y: number }, list: ['a', LOCAL] };\nexport const BUILDERS = { arrow: (id: string) => `lock:${id}`, block: function (a: string, b: string) { return `${a}-${b}`; }, none: () => 'k' };\nconst SHORT = 3;\nexport const KEYS = { SHORT, ['comp' + 'uted']: 1, 'quoted-key': 2, 7: 'seven' } as const;\nexport enum Status { On = \"on\", Off = \"off\" }\nexport const BAD_LET = { v: MUTABLE };\nexport const BAD_SPREAD = { ...SCALARS };\nexport const BAD_CALL = { v: Math.max(1, 2) };\nexport const BAD_OP = { v: 1 << 2 };\nexport const BAD_BOOL_MATH = { v: true - 1 };\nexport const BAD_UNARY = { v: !true };\nexport const BAD_METHOD = { m() { return 1; } };\nexport const BAD_BLOCK = { f: (a: string) => { const b = a; return b; } };\nexport const BAD_DEFAULT = { f: (a = 'x') => a };\nexport const BAD_ARRAY_SPREAD = [...[1]];\nexport const BAD_INFINITY = { v: 1 / 0 };\nexport const BAD_BUILDER = { f: (a: string) => a.length };",
};
const CASES: ReadonlyArray<readonly [string, unknown]> = [
  [
    'SCALARS',
    {
      'SCALARS.s': { type: 'string', value: 'x' },
      'SCALARS.n': { type: 'number', value: 1000 },
      'SCALARS.neg': { type: 'number', value: -5 },
      'SCALARS.pos': { type: 'number', value: 3 },
      'SCALARS.t': { type: 'boolean', value: true },
      'SCALARS.f': { type: 'boolean', value: false },
      'SCALARS.z': { type: 'null' },
      'SCALARS.tpl': { type: 'string', value: 'svc:q' },
      'SCALARS.nst': { type: 'string', value: 'plain' },
    },
  ],
  [
    'MATH',
    {
      'MATH.add': { type: 'number', value: 3 },
      'MATH.sub': { type: 'number', value: 3 },
      'MATH.mul': { type: 'number', value: 1200000 },
      'MATH.div': { type: 'number', value: 3 },
      'MATH.mod': { type: 'number', value: 3 },
      'MATH.pow': { type: 'number', value: 1024 },
      'MATH.cat': { type: 'string', value: 'a1' },
      'MATH.cat2': { type: 'string', value: '1b' },
    },
  ],
  [
    'REFS',
    {
      'REFS.local': { type: 'string', value: 'loc' },
      'REFS.imported': { type: 'string', value: 'svc' },
      'REFS.member': { type: 'string', value: 'a' },
      'REFS.numeric': { type: 'number', value: 2 },
      'REFS.wrapped': { type: 'string', value: 'loc' },
      'REFS.frozen.x': { type: 'number', value: 1 },
      'REFS.sat.y': { type: 'number', value: 2 },
      'REFS.list[0]': { type: 'string', value: 'a' },
      'REFS.list[1]': { type: 'string', value: 'loc' },
    },
  ],
  [
    'BUILDERS',
    {
      'BUILDERS.arrow': { type: 'template', arity: 1, value: 'lock:${0}' },
      'BUILDERS.block': { type: 'template', arity: 2, value: '${0}-${1}' },
      'BUILDERS.none': { type: 'template', arity: 0, value: 'k' },
    },
  ],
  [
    'KEYS',
    {
      'KEYS.SHORT': { type: 'number', value: 3 },
      'KEYS.computed': { type: 'number', value: 1 },
      'KEYS.quoted-key': { type: 'number', value: 2 },
      'KEYS.7': { type: 'string', value: 'seven' },
    },
  ],
  [
    'Status',
    { 'Status.On': { type: 'string', value: 'on' }, 'Status.Off': { type: 'string', value: 'off' } },
  ],
  [
    'BAD_LET',
    'ContractDefinitionError: wire (BAD_LET.v): объявлено через let/var: значение может быть переприсвоено до отправки — нужен const',
  ],
  ['BAD_SPREAD', 'ContractDefinitionError: wire (BAD_SPREAD): форма значения не разобрана: ...SCALARS'],
  ['BAD_CALL', 'ContractDefinitionError: wire (BAD_CALL.v): форма значения не разобрана: Math.max(1, 2)'],
  ['BAD_OP', 'ContractDefinitionError: wire (BAD_OP.v): форма значения не разобрана: 1 << 2'],
  ['BAD_BOOL_MATH', 'ContractDefinitionError: wire (BAD_BOOL_MATH.v): форма значения не разобрана: true - 1'],
  ['BAD_UNARY', 'ContractDefinitionError: wire (BAD_UNARY.v): форма значения не разобрана: !true'],
  [
    'BAD_METHOD',
    'ContractDefinitionError: wire (BAD_METHOD): форма значения не разобрана: m() { return 1; }',
  ],
  [
    'BAD_BLOCK',
    'ContractDefinitionError: wire (BAD_BLOCK.f): форма значения не разобрана: (a: string) => { const b = a; return b; }',
  ],
  [
    'BAD_DEFAULT',
    "ContractDefinitionError: wire (BAD_DEFAULT.f): форма значения не разобрана: (a = 'x') => a",
  ],
  [
    'BAD_ARRAY_SPREAD',
    'ContractDefinitionError: wire (BAD_ARRAY_SPREAD): форма значения не разобрана: ...[1]',
  ],
  ['BAD_INFINITY', 'ContractDefinitionError: wire (BAD_INFINITY.v): форма значения не разобрана: 1 / 0'],
  ['BAD_BUILDER', 'ContractDefinitionError: wire (BAD_BUILDER.f): форма значения не разобрана: a.length'],
  ['MISSING', 'ContractDefinitionError: MISSING (<dir>/wire.ts): объявление не найдено в файле'],
];
const dir = mkdtempSync(join(tmpdir(), 'contracts-wire-golden-'));
beforeAll(() => {
  for (const [name, text] of Object.entries(FILES)) {
    writeFileSync(join(dir, name), text);
  }
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Одна таблица на все компиляторы: значения на одних исходниках обязаны совпасть у 5.9, 6.0 и 7.x.
describe.each(COMPILERS)('wireFromTypeScript: точные значения и отказы — %s (%s)', (compiler) => {
  let program: TypeScriptProgram;
  beforeAll(() => {
    program = createProgram([join(dir, 'wire.ts')], { compiler });
  });
  afterAll(() => {
    program.dispose();
  });

  it.each(CASES)('%s', (name, expected) => {
    let result: unknown;
    try {
      result = wireFromTypeScript({ file: join(dir, 'wire.ts'), names: [name], program });
    } catch (error) {
      result =
        error instanceof Error ? `${error.name}: ${error.message.split(dir).join('<dir>')}` : String(error);
    }
    expect(result).toEqual(expected);
  });
});
