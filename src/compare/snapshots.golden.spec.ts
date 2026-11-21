import type { Verdict } from '../types/verdict.type';
import { checkEvolution } from './check-evolution';
import { compareSnapshots } from './compare-snapshots';

/**
 * «Золотая» таблица: точный итог (код, путь, ТЕКСТ) на каждый случай. Ожидания записаны
 * генератором с собранного пакета и прочитаны глазами; изменение поведения или текста находки
 * обязано менять эту таблицу осознанно.
 */

interface Expected {
  readonly ok: boolean;
  readonly violations: readonly string[];
  readonly unproven: readonly string[];
  readonly notes: readonly string[];
}
const CASES: ReadonlyArray<readonly [string, () => Verdict, Expected]> = [
  [
    'контракт только у одной стороны',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        { format: 'contracts-snapshot/2', contracts: {} },
        {},
      ),
    {
      ok: false,
      violations: ['contract-missing  — контракт есть здесь, нет у другой стороны'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'контракт только у другой стороны',
    () =>
      compareSnapshots(
        { format: 'contracts-snapshot/2', contracts: {} },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {},
      ),
    {
      ok: false,
      violations: ['contract-missing  — контракт есть у другой стороны, нет здесь'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'разные мажоры',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '2.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {},
      ),
    {
      ok: false,
      violations: [
        'major-mismatch  — мажор здесь 1.0.0, у другой стороны 2.0.0: читатель отвергнет каждое сообщение',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'обе стороны только читают',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {},
      ),
    {
      ok: false,
      violations: [
        'roles-mismatch  — роль здесь «reader», у другой стороны «reader»: никто не пишет то, что читает другая сторона',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'обе пишут и читают, поле версии разное',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'both',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'both',
              version: '1.0.0',
              versionField: 'v',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {},
      ),
    {
      ok: false,
      violations: [
        'version-field-mismatch  — здесь пишет → у другой стороны читает: поле версии у писателя "contractVersion", читатель ищет "v": читатель не найдёт версию',
        'version-field-mismatch  — у другой стороны пишет → здесь читает: поле версии у писателя "v", читатель ищет "contractVersion": читатель не найдёт версию',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'другая сторона пишет без версии, здесь legacyVersion',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: '1.0.0',
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: null,
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {},
      ),
    {
      ok: true,
      violations: [],
      unproven: [],
      notes: [
        'version-field-mismatch  — у другой стороны пишет → здесь читает: поле версии у писателя null, читатель ищет "contractVersion": payload прочитается как legacyVersion 1.0.0',
      ],
    },
  ],
  [
    'зеркало: версия, поле версии, legacyVersion, политика, форма, wire',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: { q: { type: 'string', value: 'a' } },
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.1.0',
              versionField: 'v',
              legacyVersion: '1.0.0',
              extraFields: 'kept',
              shape: { kind: 'object', fields: {}, unknownKeys: 'strip' },
              wire: { q: { type: 'string', value: 'b' } },
              examples: [],
            },
          },
        },
        { mode: 'mirror' },
      ),
    {
      ok: false,
      violations: [
        'mirror-difference  — legacyVersion здесь null, у другой стороны "1.0.0"',
        'mirror-difference  — версия здесь "1.0.0", у другой стороны "1.1.0"',
        'mirror-difference  — политика записи extraFields здесь "refused", у другой стороны "kept"',
        'mirror-difference a — «a»: поле есть здесь, нет у другой стороны',
        'version-field-mismatch  — поле версии здесь "contractVersion", у другой стороны "v"',
        'wire-constant-changed wire:q — значения на проводе: wire «q»: здесь "a", у другой стороны "b"',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'подписи сторон',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        { format: 'contracts-snapshot/2', contracts: {} },
        { labels: ['мы', 'они'] },
      ),
    { ok: false, violations: ['contract-missing  — контракт есть мы, нет они'], unproven: [], notes: [] },
  ],
  [
    'only с пробелами выбирает контракт',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
            n: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: { kind: 'string' },
              wire: {},
              examples: [],
            },
          },
        },
        { only: [' m '] },
      ),
    {
      ok: false,
      violations: [
        'type-changed  — здесь пишет → у другой стороны читает: корень: писатель шлёт объект {a, contractVersion}, читатель ждёт строка',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'образец писателя против формы читателя',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [{ a: 1 }],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {},
      ),
    {
      ok: false,
      violations: [
        'example-rejected a — здесь пишет → у другой стороны читает: образец #1 писателя читатель не примет — «a»: ожидалось строка, пришло 1',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'другая сторона пишет: образец и форма',
    () =>
      compareSnapshots(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'number' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [{ a: 'x' }],
            },
          },
        },
        {},
      ),
    {
      ok: false,
      violations: [
        'example-rejected a — у другой стороны пишет → здесь читает: образец #1 писателя читатель не примет — «a»: ожидалось число, пришло "x"',
        'type-changed a — у другой стороны пишет → здесь читает: «a»: писатель шлёт строка, читатель ждёт число',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'новый и удалённый контракт',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            old: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            fresh: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
      ),
    {
      ok: false,
      violations: ['contract-missing  — контракт удалён, а другая сторона может быть ещё на прежней версии'],
      unproven: [],
      notes: ['contract-missing  — новый контракт'],
    },
  ],
  [
    'версия снизилась',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.2.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.1.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
      ),
    {
      ok: false,
      violations: ['version-decreased  — версия снизилась: 1.2.0 → 1.1.0'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'мажор поднят',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '2.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: { kind: 'string' },
              wire: {},
              examples: [],
            },
          },
        },
      ),
    {
      ok: true,
      violations: [],
      unproven: [],
      notes: ['major-mismatch  — мажор поднят 1.0.0 → 2.0.0: читатели прежнего мажора отвергнут сообщения'],
    },
  ],
  [
    'поле версии сменилось без мажора',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.1.0',
              versionField: 'v',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
      ),
    {
      ok: false,
      violations: ['version-field-mismatch  — поле версии сменилось без мажора: "contractVersion" → "v"'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'политика и legacyVersion изменились без версии',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'kept',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
      ),
    {
      ok: false,
      violations: [
        'version-not-bumped  — форма, значения на проводе или политика изменились, а версия та же (1.0.0 → 1.0.0)',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'legacyVersion изменился без версии',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'reader',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: '1.0.0',
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
      ),
    {
      ok: false,
      violations: [
        'version-not-bumped  — форма, значения на проводе или политика изменились, а версия та же (1.0.0 → 1.0.0)',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'wire изменился без версии',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: { q: { type: 'string', value: 'a' } },
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: { q: { type: 'string', value: 'b' } },
              examples: [],
            },
          },
        },
      ),
    {
      ok: false,
      violations: [
        'version-not-bumped  — форма, значения на проводе или политика изменились, а версия та же (1.0.0 → 1.0.0)',
        'wire-constant-changed wire:q — значения на проводе: wire «q»: в новой версии "b", в прежней "a"',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'обе роли: новое обязательное поле и образцы',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'both',
              version: '1.0.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [{ a: 'x' }],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'both',
              version: '1.1.0',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: {
                  a: { optional: false, shape: { kind: 'string' } },
                  b: { optional: false, shape: { kind: 'number' } },
                },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [{ a: 'x', b: 1 }],
            },
          },
        },
      ),
    {
      ok: false,
      violations: [
        'example-rejected b — прежняя версия пишет → новая читает: образец #1 писателя читатель не примет — «b»: нет обязательного поля',
        'field-required-missing b — прежняя версия пишет → новая читает: «b»: читатель требует поле, а писатель его не кладёт',
      ],
      unproven: [],
      notes: [
        'field-unread b — новая версия пишет → прежняя читает: «b»: писатель кладёт поле, которого читатель не знает, — оно будет молча выброшено',
      ],
    },
  ],
  [
    'версия не разбирается — сравнение строкой',
    () =>
      checkEvolution(
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: 'x',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: {
                kind: 'object',
                fields: { a: { optional: false, shape: { kind: 'string' } } },
                unknownKeys: 'strip',
              },
              wire: {},
              examples: [],
            },
          },
        },
        {
          format: 'contracts-snapshot/2',
          contracts: {
            m: {
              role: 'writer',
              version: 'x',
              versionField: 'contractVersion',
              legacyVersion: null,
              extraFields: 'refused',
              shape: { kind: 'string' },
              wire: {},
              examples: [],
            },
          },
        },
      ),
    {
      ok: false,
      violations: [
        'type-changed  — новая версия пишет → прежняя читает: корень: писатель шлёт строка, читатель ждёт объект {a}',
        'version-not-bumped  — форма, значения на проводе или политика изменились, а версия та же (x → x)',
      ],
      unproven: [],
      notes: [],
    },
  ],
];

describe('compareSnapshots и checkEvolution: точные находки', () => {
  it.each(CASES)('%s', (_name, run, expected) => {
    const verdict = run();
    const line = (finding: { code: string; path: string; message: string }): string =>
      `${finding.code} ${finding.path} — ${finding.message}`;
    expect({
      ok: verdict.ok,
      violations: verdict.violations.map(line),
      unproven: verdict.unproven.map(line),
      notes: verdict.notes.map(line),
    }).toEqual(expected);
  });
});
