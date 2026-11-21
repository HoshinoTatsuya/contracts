import { z } from 'zod';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import { stableJson } from '../shape/stable-json';
import { shapeFromZod } from './shape-from-zod';

describe('форма по схеме Zod', () => {
  it('объект: поля, обязательность, вложенность, массивы, наборы строк, null', () => {
    expect(
      shapeFromZod(
        z.object({
          id: z.string().min(1),
          proto: z.enum(['https', 'http']),
          port: z.int().min(1),
          tags: z.array(z.string()).max(5),
          meta: z.object({ code: z.number().nullable() }).optional(),
        }),
      ),
    ).toEqual({
      kind: 'object',
      unknownKeys: 'strip',
      fields: {
        id: { optional: false, shape: { kind: 'string', minLength: 1 } },
        meta: {
          optional: true,
          shape: {
            kind: 'object',
            unknownKeys: 'strip',
            fields: {
              code: {
                optional: false,
                shape: { kind: 'union', options: [{ kind: 'null' }, { kind: 'number' }] },
              },
            },
          },
        },
        port: {
          optional: false,
          shape: { kind: 'number', integer: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        },
        proto: { optional: false, shape: { kind: 'enum', values: ['http', 'https'] } },
        tags: { optional: false, shape: { kind: 'array', element: { kind: 'string' }, maxItems: 5 } },
      },
    });
  });

  it('детерминированно: порядок полей и значений, запись набора строк на снимок не влияют', () => {
    const a = z.object({ a: z.string(), b: z.enum(['x', 'y']) });
    const b = z.object({ b: z.union([z.literal('y'), z.literal('x')]), a: z.string() });
    expect(stableJson(shapeFromZod(a))).toBe(stableJson(shapeFromZod(b)));
  });

  it('вход, а не выход: default и catch — необязательное поле; coerce, catch, transform — непрозрачные с границами, pipe — сложенные ограничения', () => {
    const shape = shapeFromZod(
      z.object({
        retries: z.number().default(3),
        fallback: z.string().catch('x'),
        parsed: z.string().transform(Number),
        coerced: z.coerce.number(),
        piped: z.string().pipe(z.string().min(2)),
      }),
    );
    expect(shape).toEqual({
      kind: 'object',
      unknownKeys: 'strip',
      fields: {
        coerced: {
          optional: false,
          shape: {
            kind: 'opaque',
            reason: 'coerce',
            upper: { kind: 'unknown' },
            lower: { kind: 'number' },
            semantics: 'coerce number {"kind":"number"}',
          },
        },
        fallback: {
          optional: true,
          shape: {
            kind: 'opaque',
            reason: 'catch: значение вне схемы молча заменяется запасным',
            upper: { kind: 'unknown' },
            lower: { kind: 'string' },
          },
        },
        parsed: {
          optional: false,
          shape: { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
        },
        piped: { optional: false, shape: { kind: 'string', minLength: 2, codePoints: true } },
        retries: {
          optional: true,
          shape: {
            kind: 'opaque',
            reason: 'default 3',
            exact: true,
            semantics: 'default 3',
            upper: { kind: 'number' },
          },
        },
      },
    });
  });

  it('политика неизвестных полей: strip, strict, loose, catchall', () => {
    const policy = (schema: z.ZodType) => {
      const shape = shapeFromZod(schema);
      return shape.kind === 'object' ? [shape.unknownKeys, shape.rest] : null;
    };
    expect(policy(z.object({}))).toEqual(['strip', undefined]);
    expect(policy(z.strictObject({}))).toEqual(['reject', undefined]);
    expect(policy(z.looseObject({}))).toEqual(['keep', { kind: 'unknown' }]);
    expect(policy(z.object({}).catchall(z.number()))).toEqual(['keep', { kind: 'number' }]);
  });

  it('размеченное объединение, кортеж, словарь, шаблон, пересечение', () => {
    expect(
      shapeFromZod(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a') }),
          z.object({ kind: z.literal('b'), n: z.number() }),
        ]),
      ),
    ).toEqual({
      kind: 'union',
      options: [
        {
          kind: 'object',
          unknownKeys: 'strip',
          fields: { kind: { optional: false, shape: { kind: 'enum', values: ['a'] } } },
        },
        {
          kind: 'object',
          unknownKeys: 'strip',
          fields: {
            kind: { optional: false, shape: { kind: 'enum', values: ['b'] } },
            n: { optional: false, shape: { kind: 'number' } },
          },
        },
      ],
    });
    expect(shapeFromZod(z.tuple([z.string()], z.number()))).toEqual({
      kind: 'tuple',
      items: [{ kind: 'string' }],
      rest: { kind: 'number' },
    });
    expect(shapeFromZod(z.record(z.string(), z.boolean()))).toEqual({
      kind: 'record',
      key: { kind: 'string' },
      value: { kind: 'boolean' },
    });
    expect(shapeFromZod(z.templateLiteral(['lock:', z.string()]))).toEqual({
      kind: 'template',
      pattern: '^lock:[\\s\\S]{0,}$',
    });
    expect(
      shapeFromZod(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number().optional() }))),
    ).toEqual({
      kind: 'object',
      unknownKeys: 'strip',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: true, shape: { kind: 'number' } },
      },
    });
  });

  it('литералы: число, булево, true | false сводится к boolean', () => {
    expect(shapeFromZod(z.literal(7))).toEqual({ kind: 'literal', value: 7 });
    expect(shapeFromZod(z.union([z.literal(true), z.literal(false)]))).toEqual({ kind: 'boolean' });
    expect(shapeFromZod(z.enum({ A: 'a', B: 'b' }))).toEqual({ kind: 'enum', values: ['a', 'b'] });
  });

  it('то, чего нет на проводе, и рекурсия — отказ с путём, а не пропуск', () => {
    type Node = { children: Node[] };
    const tree: z.ZodType<Node> = z.object({ children: z.array(z.lazy(() => tree)) });
    expect(() => shapeFromZod(tree, 'дерево')).toThrow(ContractDefinitionError);
    expect(() => shapeFromZod(tree, 'дерево')).toThrow('рекурсивная схема');
    expect(() => shapeFromZod(z.object({ cb: z.map(z.string(), z.string()) }))).toThrow('(cb)');
    expect(() => shapeFromZod(z.object({ n: z.symbol() }))).toThrow('«symbol»');
    expect(() => shapeFromZod({ _def: { typeName: 'ZodString' } })).toThrow('zod 3 не поддерживается');
  });
});
