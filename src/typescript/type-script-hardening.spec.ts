import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import { shapeFromTypeScript } from './shape-from-type-script';
import { COMPILERS } from './testing/compilers.fixture';

/**
 * Типы, у которых форма на проводе не совпадает с объявленной: геттер класса
 * (JSON его не несёт), `object` (массив тоже объект), `{}` (и примитив тоже),
 * раскрывающийся без конца генерик.
 */
const dir = mkdtempSync(join(tmpdir(), 'contracts-ts-hardening-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
const file = join(dir, 'types.ts');
writeFileSync(
  file,
  `
export class WithGetter { x = 1; get y(): number { return 2; } }
export type GetterHolder = { g: WithGetter };
export type Obj = { o: object };
export type Anything = { v: {} };
export type Deep<T> = { next: Deep<[T]> };
export type DeepS = Deep<string>;
export type Loose = { u: unknown; a: any };
`,
);
describe.each(COMPILERS)('TypeScript: форма на проводе, а не объявленная — %s (%s)', (compiler) => {
  const shape = (type: string) => shapeFromTypeScript({ compiler, file, type });

  it('геттер класса — отказ: JSON.stringify экземпляра его не несёт', () => {
    expect(() => shape('GetterHolder')).toThrow(ContractDefinitionError);
    expect(() => shape('GetterHolder')).toThrow('g.y');
  });

  it('object — объект или массив с чем угодно, а не пустой strip-объект', () => {
    expect(shape('Obj')).toEqual({
      kind: 'object',
      unknownKeys: 'strip',
      fields: {
        o: {
          optional: false,
          shape: {
            kind: 'union',
            options: [
              { kind: 'array', element: { kind: 'unknown' } },
              { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'unknown' } },
            ],
          },
        },
      },
    });
  });

  it('{} — любое значение, кроме null и undefined: форма его не выражает', () => {
    const outer = shape('Anything') as unknown as { fields: { v: { shape: { kind: string } } } };
    expect(outer.fields.v.shape.kind).toBe('opaque');
  });

  it('бесконечно раскрывающийся генерик — отказ контракта, а не RangeError', () => {
    expect(() => shape('DeepS')).toThrow(ContractDefinitionError);
  });

  it('unknown и any: писатель вправе положить undefined — по JSON поле пропадёт', () => {
    const outer = shape('Loose') as unknown as { fields: Record<string, { optional: boolean }> };
    expect([outer.fields.u?.optional, outer.fields.a?.optional]).toEqual([true, true]);
  });
});
