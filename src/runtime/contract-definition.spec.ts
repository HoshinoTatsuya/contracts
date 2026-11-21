import { z } from 'zod';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import { ContractPayloadError } from '../errors/contract-payload.error';
import { defineContract } from './define-contract';

/** Отказы при объявлении контракта и при чтении не-объекта — с точным текстом. */
describe('объявление контракта: отказы', () => {
  const schema = z.object({ id: z.string() });
  it.each([
    [
      'пустое имя',
      () => defineContract({ name: '  ', version: '1.0.0', schema }),
      'контракт: имя контракта пустое',
    ],
    [
      'версия не разобрана',
      () => defineContract({ name: 'c', version: 'v1', schema }),
      'c: версия не разобрана: "v1" (ожидалось MAJOR.MINOR[.PATCH])',
    ],
    [
      'legacyVersion не версия',
      () => defineContract({ name: 'c', version: '1.0.0', schema, legacyVersion: 'x' }),
      'c: legacyVersion "x" — не версия того же мажора, что 1.0.0',
    ],
    [
      'legacyVersion чужого мажора',
      () => defineContract({ name: 'c', version: '2.0.0', schema, legacyVersion: '1.9.0' }),
      'c: legacyVersion "1.9.0" — не версия того же мажора, что 2.0.0',
    ],
    [
      'корень не объект при поле версии',
      () => defineContract({ name: 'c', version: '1.0.0', schema: z.string() }),
      'c: поле версии едет в payload, а корень схемы — не объект',
    ],
    [
      'вариант объединения не объект',
      () => defineContract({ name: 'c', version: '1.0.0', schema: z.union([z.object({}), z.string()]) }),
      'c: поле версии едет в payload, а корень схемы — не объект',
    ],
    [
      'схема сама объявляет поле версии',
      () =>
        defineContract({ name: 'c', version: '1.0.0', schema: z.object({ contractVersion: z.string() }) }),
      'c (contractVersion): схема сама объявляет поле версии',
    ],
    [
      'поле версии в варианте объединения',
      () =>
        defineContract({
          name: 'c',
          version: '1.0.0',
          schema: z.union([z.object({ a: z.string() }), z.object({ v: z.string() })]),
          versionField: 'v',
        }),
      'c (v): схема сама объявляет поле версии',
    ],
    [
      'образец не проходит схему',
      () => defineContract({ name: 'c', version: '1.0.0', schema, examples: [{ id: 1 }, 'x'] }),
      'c (examples[0]): образец не проходит схему: id — ',
    ],
    [
      'образец-не-объект: путь «(корень)»',
      () => defineContract({ name: 'c', version: '1.0.0', schema, examples: ['x'] }),
      'c (examples[0]): образец не проходит схему: (корень) — ',
    ],
    [
      'образец не переживает JSON',
      () =>
        defineContract({
          name: 'c',
          version: '1.0.0',
          schema: z.object({ id: z.string(), at: z.unknown() }),
          examples: [{ id: 'x', at: new Date(0) }],
        }),
      'c (examples[0]): образец не переживает JSON без потерь',
    ],
  ] as const)('%s', (_name, define, message) => {
    expect(define).toThrow(ContractDefinitionError);
    expect(define).toThrow(message);
  });

  it('поле версии кладётся и в объект под refine, и в варианты объединения', () => {
    expect(() =>
      defineContract({
        name: 'c',
        version: '1.0.0',
        schema: z.object({ id: z.string() }).refine(() => true),
      }),
    ).not.toThrow();
    expect(() =>
      defineContract({
        name: 'c',
        version: '1.0.0',
        schema: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
      }),
    ).not.toThrow();
    expect(() =>
      defineContract({ name: 'c', version: '1.0.0', schema: z.string(), versionField: null }),
    ).not.toThrow();
  });

  it('чтение не-объекта при поле версии — отказ с видом пришедшего', () => {
    const contract = defineContract({ name: 'c', version: '1.0.0', schema });
    expect(() => contract.read(null)).toThrow(
      'c: payload не соответствует контракту: (корень) — ожидался объект, пришло null',
    );
    expect(() => contract.read([1])).toThrow(ContractPayloadError);
    expect(() => contract.read('x')).toThrow('ожидался объект, пришло string');
  });

  it('newerVersion — только для строго более новой версии', () => {
    const seen: string[] = [];
    const contract = defineContract({
      name: 'c',
      version: '1.2.0',
      schema,
      observer: { newerVersion: (event) => seen.push(event.version) },
    });
    contract.read({ contractVersion: '1.2.0', id: 'x' });
    contract.read({ contractVersion: '1.1.0', id: 'x' });
    contract.read({ contractVersion: '1.3.0', id: 'x' });
    expect(seen).toEqual(['1.3.0']);
  });
});
