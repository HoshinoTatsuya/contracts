import { z } from 'zod';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import { ContractPayloadError } from '../errors/contract-payload.error';
import { ContractVersionError } from '../errors/contract-version.error';
import { defineContract } from './define-contract';

const schema = z.object({
  taskId: z.string(),
  hosts: z.array(z.object({ name: z.string(), port: z.number().optional() })),
});

const make = (overrides: Partial<Parameters<typeof defineContract>[0]> = {}) =>
  defineContract({ name: 'scan-task', version: '1.2.0', schema, ...overrides } as Parameters<
    typeof defineContract
  >[0]);

const errorOf = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('ожидался отказ');
};

describe('контракт на рантайме: запись', () => {
  it('кладёт версию в поле версии', () => {
    expect(make().write({ taskId: 't', hosts: [] })).toEqual({
      taskId: 't',
      hosts: [],
      contractVersion: '1.2.0',
    });
    expect(make({ versionField: 'v' }).write({ taskId: 't', hosts: [] })).toEqual({
      taskId: 't',
      hosts: [],
      v: '1.2.0',
    });
  });

  it('поле вне контракта писателю класть нельзя (кроме unknownFields: keep)', () => {
    const error = errorOf(() => make().write({ taskId: 't', hosts: [{ name: 'a', extra: 1 }] } as never));
    expect(error).toBeInstanceOf(ContractPayloadError);
    expect((error as ContractPayloadError).issues.map((issue) => issue.path)).toEqual(['hosts[0].extra']);
    expect(make({ unknownFields: 'keep' }).write({ taskId: 't', hosts: [], extra: 1 } as never)).toEqual({
      taskId: 't',
      hosts: [],
      extra: 1,
      contractVersion: '1.2.0',
    });
  });

  it('неверный payload писателя — отказ с путём', () => {
    const error = errorOf(() => make().write({ taskId: 1, hosts: [] } as never)) as ContractPayloadError;
    expect(error.issues.map((issue) => issue.path)).toEqual(['taskId']);
  });
});

describe('контракт на рантайме: терпимое чтение', () => {
  it('неизвестные поля выбрасываются, о них сообщает наблюдатель с путями', () => {
    const seen: unknown[] = [];
    const contract = make({ observer: { unknownFields: (event) => seen.push(event) } });
    const result = contract.read({
      contractVersion: '1.2.0',
      taskId: 't',
      trace: 'x',
      hosts: [{ name: 'a', weight: 2 }],
    });
    expect(result).toEqual({
      data: { taskId: 't', hosts: [{ name: 'a' }] },
      version: '1.2.0',
      unknownFields: ['trace', 'hosts[].weight'],
      omittedUnknownFields: 0,
    });
    expect(seen).toEqual([
      { contract: 'scan-task', version: '1.2.0', paths: ['trace', 'hosts[].weight'], omitted: 0 },
    ]);
  });

  it('unknownFields: keep — неизвестные поля сохраняются (пересылка не теряет полей нового писателя)', () => {
    const result = make({ unknownFields: 'keep' }).read({
      contractVersion: '1.2.0',
      taskId: 't',
      trace: 'x',
      hosts: [{ name: 'a', weight: 2 }],
    });
    expect(result.data).toEqual({ taskId: 't', trace: 'x', hosts: [{ name: 'a', weight: 2 }] });
  });

  it('без неизвестных полей наблюдатель молчит', () => {
    const unknownFields = jest.fn();
    make({ observer: { unknownFields } }).read({ contractVersion: '1.2.0', taskId: 't', hosts: [] });
    expect(unknownFields).not.toHaveBeenCalled();
  });

  it('нет обязательного поля — отказ с путём', () => {
    const error = errorOf(() =>
      make().read({ contractVersion: '1.2.0', hosts: [{}] }),
    ) as ContractPayloadError;
    expect(error).toBeInstanceOf(ContractPayloadError);
    expect(error.issues.map((issue) => issue.path).sort()).toEqual(['hosts.0.name', 'taskId']);
    expect(error.message).toContain('taskId');
  });

  it('не объект — отказ', () => {
    expect(() => make().read('строка')).toThrow(ContractPayloadError);
    expect(() => make().read(null)).toThrow('ожидался объект, пришло null');
  });
});

describe('контракт на рантайме: версия', () => {
  const payload = { taskId: 't', hosts: [] };

  it('чужой мажор — отказ, а не терпимое чтение', () => {
    const error = errorOf(() =>
      make().read({ ...payload, contractVersion: '2.0.0' }),
    ) as ContractVersionError;
    expect([error.name, error.reason, error.received]).toEqual([
      'ContractVersionError',
      'foreign-major',
      '2.0.0',
    ]);
    expect(
      errorOf(() => make({ version: '2.0.0' }).read({ ...payload, contractVersion: '1.9.0' })),
    ).toBeInstanceOf(ContractVersionError);
  });

  it('нет версии — отказ; legacyVersion — принят как прежняя версия, с сообщением наблюдателю', () => {
    expect((errorOf(() => make().read(payload)) as ContractVersionError).reason).toBe('missing');
    const legacyPayload = jest.fn();
    const result = make({ legacyVersion: '1.0.0', observer: { legacyPayload } }).read(payload);
    expect(result.version).toBe('1.0.0');
    expect(legacyPayload).toHaveBeenCalledWith({ contract: 'scan-task', assumedVersion: '1.0.0' });
  });

  it('версия не разобрана — отказ', () => {
    for (const received of ['1', 'v1.2.0', '1.2.0-rc', 12, '01.2']) {
      expect([
        received,
        (errorOf(() => make().read({ ...payload, contractVersion: received })) as ContractVersionError)
          .reason,
      ]).toEqual([received, 'malformed']);
    }
  });

  it('писатель новее по минору — читается, наблюдатель узнаёт; старше — молча', () => {
    const newerVersion = jest.fn();
    const contract = make({ observer: { newerVersion } });
    expect(contract.read({ ...payload, contractVersion: '1.3.0' }).version).toBe('1.3.0');
    expect(contract.read({ ...payload, contractVersion: '1.1.0' }).version).toBe('1.1.0');
    expect(newerVersion.mock.calls).toEqual([
      [{ contract: 'scan-task', version: '1.3.0', readerVersion: '1.2.0' }],
    ]);
  });

  it('упавший хук наблюдателя не роняет чтение — уходит предупреждением процесса', () => {
    const warn = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const contract = make({
      observer: {
        unknownFields: () => {
          throw new Error('метрика недоступна');
        },
      },
    });
    expect(contract.read({ ...payload, contractVersion: '1.2.0', x: 1 }).data).toEqual(payload);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('метрика недоступна'),
      'ContractObserverWarning',
    );
  });

  it('versionField: null — версия не едет и не требуется', () => {
    const contract = make({ versionField: null });
    expect(contract.write(payload)).toEqual(payload);
    expect(contract.read(payload).version).toBe('1.2.0');
  });
});

describe('контракт на рантайме: объявление', () => {
  it('неразобранная версия, пустое имя, legacyVersion чужого мажора — отказ', () => {
    expect(() => make({ version: '1' })).toThrow(ContractDefinitionError);
    expect(() => make({ name: ' ' })).toThrow('имя контракта пустое');
    expect(() => make({ legacyVersion: '0.9.0' })).toThrow('legacyVersion');
  });

  it('схема сама объявляет поле версии или корень не объект — отказ', () => {
    expect(() => make({ schema: z.object({ contractVersion: z.string() }) })).toThrow(
      'схема сама объявляет поле версии',
    );
    expect(() => make({ schema: z.array(z.string()) })).toThrow('корень схемы — не объект');
    expect(() => make({ schema: z.array(z.string()), versionField: null })).not.toThrow();
  });

  it('образец, не проходящий схему или JSON, — отказ при объявлении', () => {
    expect(() => make({ examples: [{ taskId: 1, hosts: [] }] })).toThrow('examples[0]');
    expect(() => make({ examples: [{ taskId: 't', hosts: [] }] }).examples).not.toThrow();
  });

  it('значения на проводе: построитель ключа снимается шаблоном', () => {
    const contract = make({
      wire: { queue: 'scan-tasks', keys: { lock: (id: string) => `scan:lock:${id}` }, ttlMs: 60_000 },
    });
    expect(contract.wireValues).toEqual({
      queue: { type: 'string', value: 'scan-tasks' },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: подстановка построителя ключа в снимке — буквальный текст
      'keys.lock': { type: 'template', arity: 1, value: 'scan:lock:${0}' },
      ttlMs: { type: 'number', value: 60_000 },
    });
    expect(() => make({ wire: { bad: () => 1 } })).toThrow('построитель ключа вернул не строку');
    expect(() => make({ wire: { bad: Number.NaN } })).toThrow('wire:bad');
  });

  it('асинхронная схема — отказ на разборе, а не промис вместо данных', () => {
    const contract = make({
      schema: z.object({ a: z.string().refine(async () => true) }),
      versionField: null,
    });
    expect(() => contract.read({ a: 'x' })).toThrow('асинхронная схема');
  });
});
