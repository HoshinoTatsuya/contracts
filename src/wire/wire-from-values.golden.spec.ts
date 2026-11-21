// biome-ignore-all lint/suspicious/noTemplateCurlyInString: значения на проводе записаны с подстановками ${0}
import { compareWire } from '../compare/compare-wire';
import { wireFromValues } from './wire-from-values';

/**
 * «Золотая» таблица снятия значений на проводе: каждый вид значения и каждый
 * отказ с точным текстом; общий подобъект в двух местах — не цикл (двойник
 * детектора циклов); построитель-функция с параметром по умолчанию — отказ,
 * стрелка без скобок (в том числе со скобками в теле) — шаблон. Ожидания
 * записаны с собранного пакета и прочитаны глазами.
 */
const outcome = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
};
const cycle: Record<string, unknown> = {};
cycle.self = cycle;
const shared = { x: 1 };
class Box {
  readonly v = 1;
}
const bare = Object.create(null) as Record<string, unknown>;
bare.k = 'v';

const CASES: ReadonlyArray<readonly [string, unknown, unknown]> = [
  ['null', { n: null }, { n: { type: 'null' } }],
  ['цикл', { c: cycle }, 'ContractDefinitionError: контракт (wire:c.self): циклическая ссылка'],
  [
    'общий подобъект — не цикл',
    { a: shared, b: shared, list: [shared, shared] },
    {
      'a.x': { type: 'number', value: 1 },
      'b.x': { type: 'number', value: 1 },
      'list[0].x': { type: 'number', value: 1 },
      'list[1].x': { type: 'number', value: 1 },
    },
  ],
  [
    'экземпляр класса',
    { b: new Box() },
    'ContractDefinitionError: контракт (wire:b): значение на проводе — не простой объект',
  ],
  ['объект без прототипа', { o: bare }, { 'o.k': { type: 'string', value: 'v' } }],
  [
    'символ',
    { s: Symbol('x') },
    'ContractDefinitionError: контракт (wire:s): значение без формы на проводе: symbol',
  ],
  [
    'undefined',
    { u: undefined },
    'ContractDefinitionError: контракт (wire:u): значение без формы на проводе: undefined',
  ],
  ['bigint', { b: 1n }, 'ContractDefinitionError: контракт (wire:b): значение без формы на проводе: bigint'],
  ['NaN', { n: Number.NaN }, 'ContractDefinitionError: контракт (wire:n): число без записи в JSON: NaN'],
  [
    'два значения в один путь',
    { 'a.b': 1, a: { b: 2 } },
    'ContractDefinitionError: контракт (wire:a.b): два значения дают один путь (ключ с точкой или скобками рядом с вложенным объектом)',
  ],
  [
    'function с параметром по умолчанию',
    {
      // biome-ignore lint/complexity/useArrowFunction: исходник function-выражения и есть предмет проверки
      f: function (a = 'x') {
        return a;
      },
    },
    'ContractDefinitionError: контракт (wire:f): у построителя ключа параметр по умолчанию или rest: число подстановок не определить',
  ],
  [
    'стрелка без скобок, скобки и точка в теле',
    { f: (id: string) => `lock(${id}.x)` },
    { f: { type: 'template', arity: 1, value: 'lock(${0}.x)' } },
  ],
];

describe('wireFromValues: точные итоги', () => {
  it.each(CASES)('%s', (_name, wire, expected) => {
    expect(outcome(() => wireFromValues(wire))).toEqual(expected);
  });

  it('стрелка без скобок вокруг параметра — шаблон (исходник функции разбирается как есть)', () => {
    const noParens = new Function('return id => `lock(${id}.x)`')() as (id: string) => string;
    expect(outcome(() => wireFromValues({ f: noParens }))).toEqual({
      f: { type: 'template', arity: 1, value: 'lock(${0}.x)' },
    });
  });

  it('имя контракта — в отказе; по умолчанию — «контракт»', () => {
    expect(outcome(() => wireFromValues({ n: Number.NaN }, 'scan-task'))).toBe(
      'ContractDefinitionError: scan-task (wire:n): число без записи в JSON: NaN',
    );
  });

  it('значения в тексте различия: число, булево, null, шаблон с арностью', () => {
    const verdict = compareWire(
      {
        n: { type: 'number', value: 1 },
        b: { type: 'boolean', value: true },
        z: { type: 'null' },
        t: { type: 'template', arity: 1, value: 'a:${0}' },
        only: { type: 'boolean', value: false },
      },
      {
        n: { type: 'number', value: 2 },
        b: { type: 'boolean', value: false },
        z: { type: 'string', value: 'null' },
        t: { type: 'template', arity: 2, value: 'a:${0}:${1}' },
        theirs: { type: 'null' },
      },
      { contract: 'c', mode: 'mirror' },
    );
    expect(verdict.violations.map((finding) => finding.message)).toEqual([
      'wire «b»: здесь true, у другой стороны false',
      'wire «n»: здесь 1, у другой стороны 2',
      'wire «only»: есть здесь (false), нет у другой стороны',
      'wire «t»: здесь `a:${0}` (1 арг.), у другой стороны `a:${0}:${1}` (2 арг.)',
      'wire «theirs»: есть у другой стороны (null), нет здесь',
      'wire «z»: здесь null, у другой стороны "null"',
    ]);
  });
});
