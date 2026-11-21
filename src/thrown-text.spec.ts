import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { runCli } from './cli/run-cli';
import { validateAgainstShape } from './compare/validate-against-shape';
import { ContractPayloadError } from './errors/contract-payload.error';
import { gateChecks } from './jest/gate-checks';
import { defineContract } from './runtime/define-contract';
import { createSnapshot } from './snapshot/create-snapshot';
import { serializeSnapshot } from './snapshot/serialize-snapshot';
import * as peerSnapshot from './sources/load-peer-snapshot';
import type { GateCheck } from './types/gate-check.type';
import type { Native } from './types/native.type';
import { nativeProgram } from './typescript/engine/native-program';
import { selectEngine } from './typescript/engine/select-engine';
import { wireFromValues } from './wire/wire-from-values';

/**
 * Брошенное чужим кодом (хук наблюдателя, схема, построитель ключа, модуль
 * снимка, читатель гейта, пакет компилятора) значение, у которого `String()`
 * или чтение `message` бросает, не подменяет исходный отказ TypeError: путь
 * отказа доходит до своего типа ошибки с текстом причины.
 */
const STRANGE = [
  ['без прототипа', (): unknown => Object.create(null), '[object Object]'],
  [
    'с бросающим toString',
    (): unknown => ({
      toString: () => {
        throw new Error('toString');
      },
    }),
    '[object Object]',
  ],
  [
    'с бросающим Symbol.toPrimitive',
    (): unknown => ({
      [Symbol.toPrimitive]: () => {
        throw new Error('toPrimitive');
      },
    }),
    '[object Object]',
  ],
  [
    'ошибка с бросающим геттером message',
    (): unknown =>
      Object.defineProperty(new Error('исходное'), 'message', {
        get: () => {
          throw new Error('геттер message');
        },
      }),
    '[object Error]',
  ],
] as const;

/** Модули с броском на верхнем уровне — по одному файлу на значение: require кэширует модуль. */
const STRANGE_MODULES = [
  ['без прототипа', 'throw Object.create(null);', '[object Object]'],
  ['с бросающим toString', "throw { toString() { throw new Error('toString'); } };", '[object Object]'],
  [
    'ошибка с бросающим геттером message',
    "throw Object.defineProperty(new Error('x'), 'message', { get() { throw new Error('g'); } });",
    '[object Error]',
  ],
] as const;

/**
 * Исход действия строкой: «Класс: сообщение» отказа или «ОТКАЗА НЕТ». Сам
 * отказ в утверждение не попадает: на текущем коде это могло бы быть то самое
 * значение, которое jest не напечатает.
 */
const outcome = (action: () => unknown): string => {
  try {
    action();
    return 'ОТКАЗА НЕТ';
  } catch (error) {
    try {
      return error instanceof Error ? `${error.constructor.name}: ${error.message}` : 'не Error';
    } catch {
      return 'нечитаемый отказ';
    }
  }
};
const causeOf = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return (error as { cause?: unknown }).cause;
  }
  return undefined;
};

const schema = z.object({ id: z.string() });

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'contracts-thrown-text-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('рантайм контракта: странный отказ чужого кода — свой тип ошибки с текстом', () => {
  it.each(STRANGE)(
    'хук наблюдателя бросил значение %s — чтение не падает, предупреждение с текстом',
    (_l, make, text) => {
      const warn = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
      const contract = defineContract({
        name: 'task',
        version: '1.0.0',
        schema,
        observer: {
          unknownFields: () => {
            throw make();
          },
        },
      });
      let data: unknown;
      expect(
        outcome(() => {
          data = contract.read({ id: 'a', contractVersion: '1.0.0', extra: 1 }).data;
        }),
      ).toBe('ОТКАЗА НЕТ');
      expect(data).toEqual({ id: 'a' });
      expect(warn.mock.calls).toEqual([
        [`хук наблюдателя контракта упал: ${text}`, 'ContractObserverWarning'],
      ]);
    },
  );

  it.each(STRANGE)(
    'transform схемы бросил значение %s — ContractPayloadError с причиной',
    (_l, make, text) => {
      const thrown = make();
      const contract = defineContract({
        name: 'task',
        version: '1.0.0',
        schema: z.object({
          id: z.string().transform(() => {
            throw thrown;
          }),
        }),
      });
      const read = (): unknown => contract.read({ id: 'a', contractVersion: '1.0.0' });
      expect(outcome(read)).toBe(
        `ContractPayloadError: task: payload не соответствует контракту: (корень) — схема бросила исключение: ${text}`,
      );
      expect(causeOf(read) === thrown).toBe(true);
    },
  );

  it.each(STRANGE)('toJSON payload бросил значение %s — запись отвергнута с причиной', (_l, make, text) => {
    const contract = defineContract({ name: 'task', version: '1.0.0', schema });
    const payload = {
      id: 'a',
      toJSON: () => {
        throw make();
      },
    };
    expect(outcome(() => contract.write(payload))).toBe(
      `ContractPayloadError: task: payload не соответствует контракту: (корень) — payload не переносится JSON: ${text}`,
    );
  });

  it.each(STRANGE)(
    'отклонение схемы: сообщение и сегмент пути — значение %s — ContractPayloadError',
    (_l, make, text) => {
      const contract = defineContract({
        name: 'task',
        version: '1.0.0',
        schema: z.object({ id: z.string() }).superRefine((_value, context) => {
          context.addIssue({
            code: 'custom',
            message: make() as string,
            path: [{ key: make() } as unknown as PropertyKey],
          });
        }),
      });
      let issues: unknown;
      expect(
        outcome(() => {
          try {
            contract.read({ id: 'a', contractVersion: '1.0.0' });
          } catch (error) {
            if (error instanceof ContractPayloadError) {
              issues = error.issues;
            }
            throw error;
          }
        }),
      ).toBe(`ContractPayloadError: task: payload не соответствует контракту: ${text} — ${text}`);
      expect(issues).toEqual([{ path: text, message: text, head: text }]);
    },
  );

  it('версия в payload — BigInt — ContractVersionError «не разобрана», а не TypeError сериализации', () => {
    const contract = defineContract({ name: 'task', version: '1.0.0', schema });
    expect(outcome(() => contract.read({ id: 'a', contractVersion: 10n }))).toBe(
      'ContractVersionError: task: версия контракта не разобрана: 10 (ожидалась 1.0.0)',
    );
  });
});

describe('снимок и провод: странный отказ — ContractDefinitionError с текстом', () => {
  it.each(STRANGE)('snapshot() источника бросил значение %s', (_l, make, text) => {
    expect(
      outcome(() =>
        createSnapshot({
          writes: [
            {
              name: 'task',
              snapshot: () => {
                throw make();
              },
            },
          ],
        }),
      ),
    ).toBe(`ContractDefinitionError: task: запись снимка (роль writer) не собрана: ${text}`);
  });

  it.each(STRANGE)('построитель ключа бросил значение %s', (_l, make, text) => {
    expect(
      outcome(() =>
        wireFromValues({
          lock: (_id: string) => {
            throw make();
          },
        }),
      ),
    ).toBe(
      `ContractDefinitionError: контракт (wire:lock): построитель ключа упал на подстановках \${0}…: ${text} — он считает по аргументу, а не собирает строку`,
    );
  });
});

describe('validateAgainstShape: значение, которое JSON не показывает, — отклонение с текстом', () => {
  const cyclic = (): unknown => {
    const value: Record<string, unknown> = {};
    value.self = value;
    return value;
  };
  const values: ReadonlyArray<readonly [string, () => unknown]> = [
    ['с циклом', cyclic],
    ...STRANGE.map(([label, make]): readonly [string, () => unknown] => [
      `toJSON бросает значение ${label}`,
      () => ({
        toJSON: () => {
          throw make();
        },
      }),
    ]),
  ];
  it.each(values)('%s — «ожидалось строка, пришло [object Object]»', (_l, make) => {
    let issues: unknown;
    expect(
      outcome(() => {
        issues = validateAgainstShape(make(), { kind: 'string' });
      }),
    ).toBe('ОТКАЗА НЕТ');
    expect(issues).toEqual([
      { path: '', message: expect.stringMatching(/^ожидалось .+, пришло \[object Object\]$/) },
    ]);
  });
});

describe('гейт: странный отказ читателя и источника — проверка красная с текстом', () => {
  const options = () => ({
    root,
    snapshot: () => createSnapshot({ reads: [defineContract({ name: 'task', version: '1.0.0', schema })] }),
    committed: 'contracts.snapshot.json',
    minContracts: 1,
  });
  const runOf = (checks: readonly GateCheck[], part: string): string => {
    const check = checks.find((candidate) => candidate.name.includes(part));
    return check === undefined ? 'нет проверки' : outcome(() => check.run());
  };

  it.each(STRANGE)('read читателя бросил значение %s на образце — нарушение с причиной', (_l, make, text) => {
    writeFileSync(
      join(root, 'peer.json'),
      serializeSnapshot(
        createSnapshot({
          writes: [defineContract({ name: 'task', version: '1.0.0', schema, examples: [{ id: 'a' }] })],
        }),
      ),
    );
    const { checks } = gateChecks({
      ...options(),
      peers: [{ name: 'писатель', source: { kind: 'file', path: 'peer.json' } }],
      runtime: [
        {
          name: 'task',
          versionField: 'contractVersion',
          read: () => {
            throw make();
          },
        },
      ],
    });
    expect(runOf(checks, 'нарушений')).toBe(
      `Error: писатель: совместимость (compatible): нарушений 1:\n  task example-rejected examples[0] — писатель пишет → здесь читает: схема читателя отвергла образец #1: ${text}`,
    );
  });

  // Ошибку (Error) гейт отдаёт как есть — заворачивается только не-Error.
  it.each(STRANGE.slice(0, 3))(
    'добыча снимка другой стороны бросила значение %s — «не добыт» с текстом',
    (_l, make, text) => {
      jest.spyOn(peerSnapshot, 'loadPeerSnapshot').mockImplementation(() => {
        throw make();
      });
      const { checks } = gateChecks({
        ...options(),
        peers: [{ name: 'писатель', source: { kind: 'file', path: 'peer.json' } }],
      });
      expect(runOf(checks, 'снимок другой стороны добыт')).toBe(`Error: ${text}`);
    },
  );
});

describe('CLI: модуль снимка бросил странное значение — «НЕ ПРОВЕРЕНО» и код 2', () => {
  it.each(STRANGE_MODULES.map(([label, source, text], index) => [label, source, text, index] as const))(
    'бросок %s',
    (_l, source, text, index) => {
      const file = join(root, `snapshot-${index}.js`);
      writeFileSync(file, `${source}\n`);
      let out = '';
      let code: number | undefined;
      expect(
        outcome(() => {
          code = runCli(['snapshot', '--from', file, '--out', join(root, 'out.json')], {
            cwd: root,
            stdout: (chunk) => {
              out += chunk;
            },
            stderr: (chunk) => {
              out += chunk;
            },
          });
        }),
      ).toBe('ОТКАЗА НЕТ');
      expect({ code, out }).toEqual({ code: 2, out: `НЕ ПРОВЕРЕНО: ${text}\n` });
    },
  );
});

describe('пакет компилятора бросил странное значение — TypeScriptCompilerError с текстом', () => {
  it.each([
    ...STRANGE,
    ['null', (): unknown => null, 'null'] as const,
    [
      'с бросающим геттером code',
      (): unknown => ({
        get code(): never {
          throw new Error('code');
        },
      }),
      '[object Object]',
    ] as const,
  ])('вход sync при загрузке бросил %s — «не загрузился»', (_l, make, text) => {
    const thrown = make();
    const select = (): unknown =>
      selectEngine(
        'typescript',
        (id) => {
          if (id === 'typescript') {
            return { version: '7.9.0' };
          }
          throw thrown;
        },
        { version: '7.9.0', directory: '/pkg' },
      );
    expect(outcome(select)).toBe(
      `TypeScriptCompilerError: typescript 7.9.0 (/pkg): вход typescript/sync не загрузился: ${text}`,
    );
    expect(causeOf(select) === thrown).toBe(true);
  });

  it.each(STRANGE)('процесс компилятора при подъёме бросил %s — «не поднялся»', (_l, make, text) => {
    const thrown = make();
    const modules = {
      dialect: 'create-snapshot',
      sync: {
        API: function API() {
          throw thrown;
        },
      },
    } as unknown as Native.Modules;
    const start = (): unknown =>
      nativeProgram(modules, { version: '7.9.0', api: 'native', directory: '/pkg' }, [], {
        tsconfig: undefined,
        defaults: undefined,
        compilerOptions: {},
      });
    expect(outcome(start)).toBe(
      `TypeScriptCompilerError: typescript 7.9.0 (/pkg): процесс компилятора не поднялся: ${text}`,
    );
    expect(causeOf(start) === thrown).toBe(true);
  });
});
