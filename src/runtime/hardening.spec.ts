import { z } from 'zod';

import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { ContractPayloadError } from '../errors/contract-payload.error';
import { defineContract } from './define-contract';

/**
 * Рантайм на враждебном и необычном входе: `__proto__` в payload, глубина,
 * которую JSON.parse переживает, а рекурсия — нет, и число путей неизвестных
 * полей, уходящих в метку метрики.
 */
describe('чтение: прототип, глубина, кардинальность', () => {
  const keep = defineContract({
    name: 'k',
    version: '1.0.0',
    schema: z.object({
      user: z.string(),
      isAdmin: z.boolean().optional(),
      meta: z.object({ role: z.string().optional() }).optional(),
    }),
    unknownFields: 'keep',
  });

  it('keep: `__proto__` из payload — собственное поле, а не прототип результата', () => {
    const evil = JSON.parse('{"contractVersion":"1.0.0","user":"u","__proto__":{"isAdmin":true}}') as unknown;
    const { data } = keep.read(evil);
    const record = data as Record<string, unknown>;
    expect({
      isAdmin: record.isAdmin,
      prototypeIsObject: Object.getPrototypeOf(data) === Object.prototype,
      ownProto: Object.hasOwn(data, '__proto__'),
      globalPolluted: ({} as Record<string, unknown>).isAdmin,
    }).toEqual({ isAdmin: undefined, prototypeIsObject: true, ownProto: true, globalPolluted: undefined });
  });

  it('keep: `__proto__` во вложенном объекте — тоже собственное поле', () => {
    const evil = JSON.parse(
      '{"contractVersion":"1.0.0","user":"u","meta":{"__proto__":{"role":"admin"}}}',
    ) as unknown;
    const { data } = keep.read(evil);
    const meta = (data as { meta: Record<string, unknown> }).meta;
    expect({ role: meta.role, prototypeIsObject: Object.getPrototypeOf(meta) === Object.prototype }).toEqual({
      role: undefined,
      prototypeIsObject: true,
    });
  });

  it.each([
    ['strip', 'strip'],
    ['keep', 'keep'],
  ] as const)('глубокий payload под z.unknown (%s): разбор без RangeError', (_label, unknownFields) => {
    const contract = defineContract({
      name: 'd',
      version: '1.0.0',
      schema: z.object({ blob: z.unknown() }),
      unknownFields,
    });
    const depth = 20_000;
    const text = `{"contractVersion":"1.0.0","blob":${'['.repeat(depth)}${']'.repeat(depth)}}`;
    const nested = `{"contractVersion":"1.0.0","blob":${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}}`;
    expect(() => contract.read(JSON.parse(text))).not.toThrow();
    expect(() => contract.read(JSON.parse(nested))).not.toThrow();
  });

  it('глубокий payload под открытым объектом: отказ контракта, а не RangeError', () => {
    const contract = defineContract({
      name: 'd',
      version: '1.0.0',
      schema: z.looseObject({}),
      unknownFields: 'keep',
    });
    const depth = 20_000;
    const nested = `{"contractVersion":"1.0.0","x":${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}}`;
    let error: unknown;
    try {
      contract.read(JSON.parse(nested));
    } catch (caught) {
      error = caught;
    }
    expect(error === undefined || error instanceof ContractPayloadError).toBe(true);
  });

  it('значение, пропущенное схемой тем же объектом, не обходится (счётчик обращений к ключам)', () => {
    let enumerations = 0;
    const counted = <T extends object>(target: T): T =>
      new Proxy(target, {
        ownKeys: (inner) => {
          enumerations += 1;
          return Reflect.ownKeys(inner);
        },
      });
    const blob = counted({ a: counted({ b: counted({ c: 1 }) }), d: counted([counted({ e: 2 })]) });
    const contract = defineContract({ name: 'u', version: '1.0.0', schema: z.object({ blob: z.unknown() }) });
    const result = contract.read({ contractVersion: '1.0.0', blob });
    expect(result.data.blob).toBe(blob);
    expect(enumerations).toBe(0);
  });

  it('неизвестные поля: индексы свёрнуты, повторы убраны, число путей ограничено', () => {
    const events: Array<{ paths: readonly string[]; omitted: number | undefined }> = [];
    const contract = defineContract({
      name: 'b',
      version: '1.0.0',
      schema: z.object({ items: z.array(z.object({ id: z.string() })) }),
      observer: {
        unknownFields: (event) => {
          events.push({ paths: event.paths, omitted: (event as { omitted?: number }).omitted });
        },
      },
    });
    const items = Array.from({ length: 5000 }, (_, index) => ({
      id: `i${index}`,
      extra: 1,
      [`k${index}`]: 2,
    }));
    const result = contract.read({ contractVersion: '1.0.0', items });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.paths.length).toBe(CONTRACT_FORMAT.MAX_UNKNOWN_PATHS);
    expect(event?.paths).toContain('items[].extra');
    expect(event?.omitted).toBe(5001 - CONTRACT_FORMAT.MAX_UNKNOWN_PATHS);
    expect(result.unknownFields).toEqual(event?.paths);
  });
});

describe('запись', () => {
  it('на провод уходит проверенный ВХОД (не выход transform/default) плюс версия', () => {
    const contract = defineContract({
      name: 't',
      version: '1.0.0',
      schema: z.object({ s: z.string().trim().toLowerCase(), d: z.number().default(5) }),
    });
    expect(contract.write({ s: '  ABC ' })).toEqual({ s: '  ABC ', contractVersion: '1.0.0' });
  });

  it('`__proto__` во входе writer не превращает в прототип payload', () => {
    const contract = defineContract({
      name: 'w',
      version: '1.0.0',
      schema: z.looseObject({ a: z.string() }),
      unknownFields: 'keep',
    });
    const input = JSON.parse('{"a":"x","__proto__":{"admin":true}}') as { a: string };
    const payload = contract.write(input) as Record<string, unknown>;
    expect({
      admin: payload.admin,
      prototypeIsObject: Object.getPrototypeOf(payload) === Object.prototype,
    }).toEqual({
      admin: undefined,
      prototypeIsObject: true,
    });
  });
});
