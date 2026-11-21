import type { Shape } from '../types/shape.type';
import { compareShapes } from './compare-shapes';

/**
 * «Золотая» таблица: точный итог (код, путь, ТЕКСТ) на каждый случай. Ожидания записаны
 * генератором с собранного пакета и прочитаны глазами; изменение поведения или текста находки
 * обязано менять эту таблицу осознанно.
 */

type Options = Omit<Parameters<typeof compareShapes>[2], 'contract' | 'mode'> & {
  readonly mode?: 'compatible' | 'aligned';
};
interface Expected {
  readonly violations: readonly string[];
  readonly unproven: readonly string[];
  readonly notes: readonly string[];
}
const CASES: ReadonlyArray<readonly [string, Shape, Shape, Options, Expected]> = [
  [
    'числа: та же форма',
    { kind: 'number' },
    { kind: 'number' },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'числа: читатель целое',
    { kind: 'number' },
    { kind: 'number', integer: true },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — только целые, писатель вправе слать дробные',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'числа: нижняя граница строже',
    { kind: 'number', minimum: 0 },
    { kind: 'number', minimum: 1 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — нижняя граница ≥ 1, у писателя 0',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'числа: нижняя граница — исключающая против включающей',
    { kind: 'number', minimum: 1 },
    { kind: 'number', exclusiveMinimum: 1 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — нижняя граница > 1, у писателя 1',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'числа: исключающая у обоих',
    { kind: 'number', exclusiveMinimum: 1 },
    { kind: 'number', exclusiveMinimum: 1 },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'числа: включающая шире исключающей писателя',
    { kind: 'number', exclusiveMinimum: 1 },
    { kind: 'number', minimum: 1 },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'числа: обе нижние у писателя, исключающая выше',
    { kind: 'number', minimum: 0, exclusiveMinimum: 2 },
    { kind: 'number', minimum: 1 },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'числа: верхняя граница строже',
    { kind: 'number', maximum: 10 },
    { kind: 'number', maximum: 5 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — верхняя граница ≤ 5, у писателя 10',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'числа: верхняя исключающая против включающей',
    { kind: 'number', maximum: 5 },
    { kind: 'number', exclusiveMaximum: 5 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — верхняя граница < 5, у писателя 5',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'числа: обе верхние у писателя, исключающая ниже',
    { kind: 'number', maximum: 10, exclusiveMaximum: 3 },
    { kind: 'number', maximum: 5 },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'числа: кратность',
    { kind: 'number', multipleOf: 4 },
    { kind: 'number', multipleOf: 2 },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'числа: кратность не делится',
    { kind: 'number', multipleOf: 3 },
    { kind: 'number', multipleOf: 2 },
    {},
    {
      violations: ['constraint-narrowed  — корень: читатель строже писателя — кратность 2'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'числа: кратность у читателя, у писателя нет',
    { kind: 'number' },
    { kind: 'number', multipleOf: 2 },
    {},
    {
      violations: ['constraint-narrowed  — корень: читатель строже писателя — кратность 2'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'строки: длина',
    { kind: 'string', minLength: 1, maxLength: 9 },
    { kind: 'string', minLength: 2, maxLength: 5 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — длина не меньше 2, у писателя 1; длина не больше 5, у писателя 9',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'строки: длина без потолка у писателя',
    { kind: 'string' },
    { kind: 'string', maxLength: 5 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — длина не больше 5, у писателя без потолка',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'строки: шаблон и формат',
    { kind: 'string' },
    { kind: 'string', patterns: ['/^a/'], formats: ['email'] },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — шаблон /^a/, которого нет у писателя; формат email, которого нет у писателя',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'строки: тот же шаблон и формат',
    { kind: 'string', patterns: ['/^a/'], formats: ['email'] },
    { kind: 'string', patterns: ['/^a/'], formats: ['email'] },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'enum против enum',
    { kind: 'enum', values: ['a', 'b'] },
    { kind: 'enum', values: ['a'] },
    {},
    {
      violations: ['wire-value-unknown  — корень: читатель не знает строк на проводе «b»'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'enum против строки с длиной и шаблоном',
    { kind: 'enum', values: ['ab', 'abc', 'x'] },
    { kind: 'string', minLength: 2, maxLength: 2, patterns: ['/^a/i'] },
    {},
    {
      violations: ['constraint-narrowed  — корень: читатель строже писателя — не примет строки «abc», «x»'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'enum против строки с форматом',
    { kind: 'enum', values: ['a'] },
    { kind: 'string', formats: ['email'] },
    {},
    {
      violations: [],
      unproven: [
        'not-proven  — корень: читатель проверяет формат email, а строки писателя «a» снимок по формату проверить не может',
      ],
      notes: [],
    },
  ],
  [
    'enum против шаблона',
    { kind: 'enum', values: ['lock:1', 'x'] },
    { kind: 'template', pattern: '^lock:[\\s\\S]{0,}$' },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — шаблон /^lock:[\\s\\S]{0,}$/ не примет «x»',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'enum против числа',
    { kind: 'enum', values: ['a'] },
    { kind: 'number' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт строка «a», читатель ждёт число'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'литерал против литерала',
    { kind: 'literal', value: 1 },
    { kind: 'literal', value: 2 },
    {},
    { violations: ['literal-changed  — корень: писатель шлёт 1, читатель ждёт 2'], unproven: [], notes: [] },
  ],
  [
    'литерал true против boolean',
    { kind: 'literal', value: true },
    { kind: 'boolean' },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'литерал против числа с границей и кратностью',
    { kind: 'literal', value: 3 },
    { kind: 'number', minimum: 4, multipleOf: 2, integer: true },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — нижняя граница ≥ 4, у писателя 3; кратность 2',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'дробный литерал против целого',
    { kind: 'literal', value: 1.5 },
    { kind: 'number', integer: true },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — только целые, писатель вправе слать дробные',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'литерал против строки',
    { kind: 'literal', value: 1 },
    { kind: 'string' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт литерал 1, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'строка против enum',
    { kind: 'string' },
    { kind: 'enum', values: ['a'] },
    {},
    {
      violations: [
        'wire-value-unknown  — корень: писатель вправе слать любую строку, читатель принимает только строка «a»',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'строка против шаблона',
    { kind: 'string' },
    { kind: 'template', pattern: '^x$' },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — шаблон /^x$/, писатель вправе слать любую строку',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'строка против числа',
    { kind: 'string' },
    { kind: 'number' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт строка, читатель ждёт число'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'шаблон против шаблона',
    { kind: 'template', pattern: '^a$' },
    { kind: 'template', pattern: '^b$' },
    {},
    {
      violations: ['constraint-narrowed  — корень: читатель строже писателя — шаблон /^b$/ вместо /^a$/'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'шаблон против того же шаблона',
    { kind: 'template', pattern: '^a$' },
    { kind: 'template', pattern: '^a$' },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'шаблон против строки с шаблоном',
    { kind: 'template', pattern: '^a$' },
    { kind: 'string', patterns: ['/^a$/'] },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'шаблон против числа',
    { kind: 'template', pattern: '^a$' },
    { kind: 'number' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт строка по шаблону /^a$/, читатель ждёт число'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'boolean против литерала',
    { kind: 'boolean' },
    { kind: 'literal', value: true },
    {},
    {
      violations: ['constraint-narrowed  — корень: читатель строже писателя — принимает только true'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'boolean против строки',
    { kind: 'boolean' },
    { kind: 'string' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт булево, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  ['null против null', { kind: 'null' }, { kind: 'null' }, {}, { violations: [], unproven: [], notes: [] }],
  [
    'null против строки',
    { kind: 'null' },
    { kind: 'string' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт null, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'undefined против undefined',
    { kind: 'undefined' },
    { kind: 'undefined' },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'unknown писателя против строки',
    { kind: 'unknown' },
    { kind: 'string' },
    {},
    {
      violations: ['type-changed  — корень: писатель не описывает тип (что угодно), читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'что угодно у читателя',
    { kind: 'string' },
    { kind: 'unknown' },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'never у писателя',
    { kind: 'never' },
    { kind: 'string' },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'bigint',
    { kind: 'bigint' },
    { kind: 'bigint' },
    {},
    {
      violations: ['json-lossy  — корень: bigint не переживает JSON (JSON.stringify отказывает)'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'Date против Date',
    { kind: 'date' },
    { kind: 'date' },
    {},
    {
      violations: [
        'json-lossy  — корень: читатель ждёт Date, а по JSON дата едет строкой — z.date() её отвергнет (нужен z.coerce.date() или z.iso.datetime())',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'Date против строки',
    { kind: 'date' },
    { kind: 'string' },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'Date против строки с форматом: год вне 0000–9999 — расширенный год, не доказано',
    { kind: 'date' },
    { kind: 'string', formats: ['datetime'] },
    {},
    {
      violations: [],
      unproven: [
        'not-proven  — корень: Date писателя едет строкой toISOString (с годом вне 0000–9999 — расширенный год «+010000-…»), а читатель проверяет datetime — снимок не доказывает, что примет каждую дату',
      ],
      notes: [],
    },
  ],
  [
    'строка против Date',
    { kind: 'string' },
    { kind: 'date' },
    {},
    {
      violations: [
        'json-lossy  — корень: читатель ждёт Date, а по JSON дата едет строкой — z.date() её отвергнет (нужен z.coerce.date() или z.iso.datetime())',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект: поле выброшено, переименование',
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        x: { optional: false, shape: { kind: 'number' } },
      },
      unknownKeys: 'strip',
    },
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        y: { optional: false, shape: { kind: 'number' } },
      },
      unknownKeys: 'strip',
    },
    {},
    {
      violations: [
        'field-required-missing y — «y»: читатель требует поле, а писатель его не кладёт (похоже на переименование «y» ↔ «x»)',
      ],
      unproven: [],
      notes: [
        'field-unread x — «x»: писатель кладёт поле, которого читатель не знает, — оно будет молча выброшено (похоже на переименование «x» ↔ «y»)',
      ],
    },
  ],
  [
    'объект: два похожих поля — без подсказки',
    { kind: 'object', fields: { x: { optional: false, shape: { kind: 'number' } } }, unknownKeys: 'strip' },
    {
      kind: 'object',
      fields: {
        y: { optional: false, shape: { kind: 'number' } },
        z: { optional: true, shape: { kind: 'number' } },
      },
      unknownKeys: 'strip',
    },
    {},
    {
      violations: [
        'field-required-missing y — «y»: читатель требует поле, а писатель его не кладёт (похоже на переименование «y» ↔ «x»)',
      ],
      unproven: [],
      notes: [
        'field-unread x — «x»: писатель кладёт поле, которого читатель не знает, — оно будет молча выброшено',
        'field-unsent z — «z»: читатель читает необязательное поле, а писатель его не кладёт (похоже на переименование «z» ↔ «x»)',
      ],
    },
  ],
  [
    'объект: обязательное у читателя, писатель вправе опустить',
    { kind: 'object', fields: { a: { optional: true, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {},
    {
      violations: ['field-may-be-missing a — «a»: обязательно для читателя, а писатель вправе его опустить'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект: строгий читатель',
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: false, shape: { kind: 'number' } },
      },
      unknownKeys: 'strip',
    },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'reject' },
    {},
    {
      violations: [
        'field-rejected b — «b»: писатель кладёт поле, которого строгий читатель не знает, — сообщение будет отвергнуто',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект: читатель keep с типом',
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: false, shape: { kind: 'number' } },
      },
      unknownKeys: 'strip',
    },
    {
      kind: 'object',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
      unknownKeys: 'keep',
      rest: { kind: 'string' },
    },
    {},
    {
      violations: ['type-changed b — «b»: писатель шлёт число, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект: открытый писатель против строгого',
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'unknown' } },
    { kind: 'object', fields: {}, unknownKeys: 'reject' },
    {},
    {
      violations: [
        'open-to-strict {*} — корень: писатель вправе класть произвольные поля, строгий читатель отвергнет сообщение',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект: открытый писатель против открытого',
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'number' } },
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'string' } },
    {},
    {
      violations: ['type-changed {*} — «{*}»: писатель шлёт число, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект: открытый писатель против keep без rest',
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'number' } },
    { kind: 'object', fields: {}, unknownKeys: 'keep' },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'объект: открытый писатель без rest против необязательного поля',
    { kind: 'object', fields: {}, unknownKeys: 'keep' },
    { kind: 'object', fields: { b: { optional: true, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {},
    {
      violations: ['type-changed b — «b»: писатель не описывает тип (что угодно), читатель ждёт строка'],
      unproven: [],
      notes: ['field-unread {*} — корень: произвольные поля писателя читатель молча выбрасывает'],
    },
  ],
  [
    'объект: открытый писатель против strip',
    {
      kind: 'object',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
      unknownKeys: 'keep',
      rest: { kind: 'unknown' },
    },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {},
    {
      violations: [],
      unproven: [],
      notes: ['field-unread {*} — корень: произвольные поля писателя читатель молча выбрасывает'],
    },
  ],
  [
    'объект против словаря',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'number' } } }, unknownKeys: 'strip' },
    { kind: 'record', key: { kind: 'enum', values: ['a', 'b'] }, value: { kind: 'number' } },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'открытый объект против словаря',
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'number' } },
    { kind: 'record', key: { kind: 'string', patterns: ['/^a/'] }, value: { kind: 'number' } },
    {},
    {
      violations: [
        'constraint-narrowed {key} — «{key}»: читатель строже писателя — шаблон /^a/, которого нет у писателя',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект против числа',
    { kind: 'object', fields: {}, unknownKeys: 'strip' },
    { kind: 'number' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт объект {}, читатель ждёт число'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'словарь против словаря',
    { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } },
    { kind: 'record', key: { kind: 'string', minLength: 1 }, value: { kind: 'string' } },
    {},
    {
      violations: [
        'constraint-narrowed {key} — «{key}»: читатель строже писателя — длина не меньше 1, у писателя 0',
        'type-changed {*} — «{*}»: писатель шлёт число, читатель ждёт строка',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'словарь против keep-объекта',
    { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } },
    {
      kind: 'object',
      fields: { a: { optional: true, shape: { kind: 'number' } } },
      unknownKeys: 'keep',
      rest: { kind: 'string' },
    },
    {},
    {
      violations: ['type-changed {*} — «{*}»: писатель шлёт число, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'словарь против strip-объекта',
    { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } },
    { kind: 'object', fields: { a: { optional: true, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {},
    {
      violations: ['type-changed a — «a»: писатель шлёт число, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'словарь против строгого объекта',
    { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } },
    { kind: 'object', fields: { a: { optional: true, shape: { kind: 'number' } } }, unknownKeys: 'reject' },
    {},
    {
      violations: [
        'open-to-strict {*} — корень: словарь писателя вправе нести любые ключи, строгий читатель отвергнет сообщение',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'словарь против объекта с обязательным полем',
    { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'number' } } }, unknownKeys: 'strip' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт словарь число, читатель ждёт объект {a}'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'массивы: границы и элемент',
    { kind: 'array', element: { kind: 'number' }, minItems: 1, maxItems: 9 },
    { kind: 'array', element: { kind: 'string' }, minItems: 2, maxItems: 5 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — не меньше 2 элементов, у писателя 1; не больше 5 элементов, у писателя 9',
        'type-changed [] — «[]»: писатель шлёт число, читатель ждёт строка',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'массив без потолка у писателя',
    { kind: 'array', element: { kind: 'number' } },
    { kind: 'array', element: { kind: 'number' }, maxItems: 3 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — не больше 3 элементов, у писателя без потолка',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'массив против строки',
    { kind: 'array', element: { kind: 'number' } },
    { kind: 'string' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт массив число, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'массив с undefined против массива с null',
    { kind: 'array', element: { kind: 'union', options: [{ kind: 'number' }, { kind: 'undefined' }] } },
    { kind: 'array', element: { kind: 'union', options: [{ kind: 'number' }, { kind: 'null' }] } },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'массив из одного undefined',
    { kind: 'array', element: { kind: 'undefined' } },
    { kind: 'array', element: { kind: 'number' } },
    {},
    {
      violations: [
        'json-lossy [] — «[]»: писатель вправе положить undefined — по JSON оно едет как null, а читатель null не примет',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'кортеж против массива',
    {
      kind: 'tuple',
      items: [{ kind: 'number' }, { kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] }],
      rest: { kind: 'boolean' },
    },
    { kind: 'array', element: { kind: 'number' }, minItems: 3, maxItems: 5 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — не меньше 3 элементов, кортеж писателя — от 1; не больше 5 элементов, кортеж писателя — с хвостом без потолка',
        'type-changed [1] — «[1]»: писатель шлёт строка, читатель ждёт число',
        'json-lossy [1] — «[1]»: писатель вправе положить undefined — по JSON оно едет как null, а читатель null не примет',
        'type-changed [...] — «[...]»: писатель шлёт булево, читатель ждёт число',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'кортеж с хвостом против массива с потолком',
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'number' } },
    { kind: 'array', element: { kind: 'number' }, maxItems: 5 },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — не больше 5 элементов, кортеж писателя — с хвостом без потолка',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'кортеж: писатель длиннее',
    { kind: 'tuple', items: [{ kind: 'number' }, { kind: 'number' }] },
    { kind: 'tuple', items: [{ kind: 'number' }] },
    {},
    {
      violations: [
        'tuple-length [1] — корень: писатель вправе прислать 2 элементов, читатель принимает не больше 1',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'кортеж: читатель требует больше',
    { kind: 'tuple', items: [{ kind: 'number' }] },
    { kind: 'tuple', items: [{ kind: 'number' }, { kind: 'string' }] },
    {},
    {
      violations: [
        'tuple-length [1] — корень: читатель требует не меньше 2 элементов, писатель вправе прислать 1',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'кортеж: читатель — необязательный член',
    { kind: 'tuple', items: [{ kind: 'number' }] },
    {
      kind: 'tuple',
      items: [{ kind: 'number' }, { kind: 'union', options: [{ kind: 'string' }, { kind: 'undefined' }] }],
    },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'кортеж: хвост писателя, у читателя нет',
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'string' } },
    { kind: 'tuple', items: [{ kind: 'number' }] },
    {},
    {
      violations: [
        'tuple-length [...] — корень: писатель вправе прислать сколько угодно элементов, читатель принимает не больше 1',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'кортеж: хвост против хвоста',
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'string' } },
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'number' } },
    {},
    {
      violations: ['type-changed [...] — «[...]»: писатель шлёт строка, читатель ждёт число'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'кортеж: члены против хвоста читателя',
    { kind: 'tuple', items: [{ kind: 'number' }, { kind: 'string' }] },
    { kind: 'tuple', items: [{ kind: 'number' }], rest: { kind: 'string' } },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'кортеж против строки',
    { kind: 'tuple', items: [{ kind: 'number' }] },
    { kind: 'string' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт кортеж из 1, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объединение писателя',
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'number' }] },
    { kind: 'string' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт число, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'enum против объединения',
    { kind: 'enum', values: ['a', 'b', 'c'] },
    {
      kind: 'union',
      options: [
        { kind: 'enum', values: ['a'] },
        { kind: 'string', minLength: 2 },
      ],
    },
    {},
    {
      violations: ['wire-value-unknown  — корень: читатель не знает строк на проводе «b», «c»'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'enum против объединения с непрозрачным',
    { kind: 'enum', values: ['a', 'b'] },
    {
      kind: 'union',
      options: [
        { kind: 'enum', values: ['a'] },
        { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
      ],
    },
    {},
    {
      violations: [],
      unproven: [
        'not-proven  — корень: читатель — строка (transform): что он примет из «строка «b»», форма не выражает; совместимость не доказана',
      ],
      notes: [],
    },
  ],
  [
    'объект против объединения по метке',
    {
      kind: 'object',
      fields: {
        t: { optional: false, shape: { kind: 'enum', values: ['a'] } },
        v: { optional: false, shape: { kind: 'string' } },
      },
      unknownKeys: 'strip',
    },
    {
      kind: 'union',
      options: [
        {
          kind: 'object',
          fields: {
            t: { optional: false, shape: { kind: 'enum', values: ['a'] } },
            v: { optional: false, shape: { kind: 'number' } },
          },
          unknownKeys: 'strip',
        },
        {
          kind: 'object',
          fields: { t: { optional: false, shape: { kind: 'enum', values: ['b'] } } },
          unknownKeys: 'strip',
        },
      ],
    },
    {},
    {
      violations: ['type-changed v — «v»: писатель шлёт строка, читатель ждёт число'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект против объединения: неизвестная метка',
    {
      kind: 'object',
      fields: { t: { optional: false, shape: { kind: 'enum', values: ['c'] } } },
      unknownKeys: 'strip',
    },
    {
      kind: 'union',
      options: [
        {
          kind: 'object',
          fields: { t: { optional: false, shape: { kind: 'enum', values: ['a'] } } },
          unknownKeys: 'strip',
        },
        {
          kind: 'object',
          fields: { t: { optional: false, shape: { kind: 'enum', values: ['b'] } } },
          unknownKeys: 'strip',
        },
      ],
    },
    {},
    { violations: ['wire-value-unknown t — «t»: читатель не знает варианта «c»'], unproven: [], notes: [] },
  ],
  [
    'объект против объединения: сочетание меток',
    {
      kind: 'object',
      fields: {
        p: { optional: false, shape: { kind: 'enum', values: ['1'] } },
        t: { optional: false, shape: { kind: 'enum', values: ['b'] } },
      },
      unknownKeys: 'strip',
    },
    {
      kind: 'union',
      options: [
        {
          kind: 'object',
          fields: {
            p: { optional: false, shape: { kind: 'enum', values: ['1'] } },
            t: { optional: false, shape: { kind: 'enum', values: ['a'] } },
          },
          unknownKeys: 'strip',
        },
        {
          kind: 'object',
          fields: {
            p: { optional: false, shape: { kind: 'enum', values: ['2'] } },
            t: { optional: false, shape: { kind: 'enum', values: ['b'] } },
          },
          unknownKeys: 'strip',
        },
      ],
    },
    {},
    {
      violations: [
        'union-option-unmatched  — корень: сочетание меток p=«1», t=«b» не совпадает ни с одним вариантом читателя, хотя каждую строку он знает',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект против объединения без меток',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {
      kind: 'union',
      options: [
        {
          kind: 'object',
          fields: { a: { optional: false, shape: { kind: 'number' } } },
          unknownKeys: 'strip',
        },
        {
          kind: 'object',
          fields: { b: { optional: false, shape: { kind: 'string' } } },
          unknownKeys: 'strip',
        },
      ],
    },
    {},
    {
      violations: [
        'union-option-unmatched  — корень: метки (их нет) не различают 2 вариантов читателя, а форму писателя целиком не принимает ни один; ближе всех вариант с нарушениями: «a»: писатель шлёт строка, читатель ждёт число',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'объект против объединения без меток — принят вторым',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {
      kind: 'union',
      options: [
        {
          kind: 'object',
          fields: { a: { optional: false, shape: { kind: 'number' } } },
          unknownKeys: 'strip',
        },
        {
          kind: 'object',
          fields: { a: { optional: false, shape: { kind: 'string' } } },
          unknownKeys: 'strip',
        },
      ],
    },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'объект против объединения с keep-вариантом и словарём',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'number' } } }, unknownKeys: 'strip' },
    {
      kind: 'union',
      options: [
        {
          kind: 'object',
          fields: { b: { optional: false, shape: { kind: 'string' } } },
          unknownKeys: 'reject',
        },
        { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } },
      ],
    },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'объект против объединения со словарём, метка не подходит',
    {
      kind: 'object',
      fields: { t: { optional: false, shape: { kind: 'enum', values: ['x'] } } },
      unknownKeys: 'strip',
    },
    {
      kind: 'union',
      options: [
        {
          kind: 'object',
          fields: { t: { optional: false, shape: { kind: 'enum', values: ['a'] } } },
          unknownKeys: 'strip',
        },
        {
          kind: 'object',
          fields: { t: { optional: false, shape: { kind: 'enum', values: ['b'] } } },
          unknownKeys: 'strip',
        },
        { kind: 'record', key: { kind: 'string' }, value: { kind: 'unknown' } },
      ],
    },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'число против объединения: ближайший того же вида',
    { kind: 'number' },
    { kind: 'union', options: [{ kind: 'number', minimum: 1 }, { kind: 'string' }] },
    {},
    {
      violations: [
        'constraint-narrowed  — корень: читатель строже писателя — нижняя граница ≥ 1, у писателя без границы',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'число против объединения другого вида',
    { kind: 'number' },
    { kind: 'union', options: [{ kind: 'string' }, { kind: 'boolean' }] },
    {},
    {
      violations: [
        'union-option-unmatched  — корень: писатель шлёт число, ни один вариант читателя (булево | строка) это не принимает',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'число против объединения: непрозрачный вариант',
    { kind: 'number' },
    {
      kind: 'union',
      options: [
        { kind: 'string' },
        { kind: 'opaque', reason: 'coerce', upper: { kind: 'unknown' }, lower: { kind: 'number' } },
      ],
    },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'непрозрачный читатель: укладывается в lower',
    { kind: 'number', minimum: 6 },
    { kind: 'opaque', reason: 'coerce', upper: { kind: 'unknown' }, lower: { kind: 'number', minimum: 5 } },
    {},
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'непрозрачный читатель: не укладывается',
    { kind: 'string' },
    { kind: 'opaque', reason: 'coerce', upper: { kind: 'unknown' }, lower: { kind: 'number' } },
    {},
    {
      violations: [],
      unproven: [
        'not-proven  — корень: читатель — что угодно (coerce): что он примет из «строка», форма не выражает (наверняка — число); совместимость не доказана',
      ],
      notes: [],
    },
  ],
  [
    'непрозрачный читатель: вне upper',
    { kind: 'number' },
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт число, читатель ждёт строка'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'непрозрачный писатель',
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    { kind: 'number' },
    {},
    {
      violations: ['type-changed  — корень: писатель шлёт строка, читатель ждёт число'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'одинаковый непрозрачный — без sameSource',
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    {},
    {
      violations: [],
      unproven: [
        'not-proven  — корень: читатель — строка (transform): что он примет из «строка», форма не выражает; совместимость не доказана',
      ],
      notes: [],
    },
  ],
  [
    'aligned: лишнее поле писателя',
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: false, shape: { kind: 'string' } },
      },
      unknownKeys: 'strip',
    },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { mode: 'aligned' },
    {
      violations: [
        'field-unread b — «b»: писатель кладёт поле, которого читатель не знает, — оно будет молча выброшено',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'aligned: необязательное поле читателя',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: true, shape: { kind: 'string' } },
      },
      unknownKeys: 'strip',
    },
    { mode: 'aligned' },
    {
      violations: ['field-unsent b — «b»: читатель читает необязательное поле, а писатель его не кладёт'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'aligned: открытый писатель против strip',
    { kind: 'object', fields: {}, unknownKeys: 'keep', rest: { kind: 'unknown' } },
    { kind: 'object', fields: {}, unknownKeys: 'strip' },
    { mode: 'aligned' },
    {
      violations: ['field-unread {*} — корень: произвольные поля писателя читатель молча выбрасывает'],
      unproven: [],
      notes: [],
    },
  ],
  [
    'kept: против строгого',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'reject' },
    { writerExtraFields: 'kept' },
    {
      violations: [
        "open-to-strict {*} — корень: писатель пересылает поля вне формы (unknownFields: 'keep'), строгий читатель отвергнет сообщение с ними",
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'refused: против строгого — двойник без находки',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'reject' },
    { writerExtraFields: 'refused' },
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'kept: против strip',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { writerExtraFields: 'kept' },
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'kept: против keep с типом',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {
      kind: 'object',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
      unknownKeys: 'keep',
      rest: { kind: 'number' },
    },
    { writerExtraFields: 'kept' },
    {
      violations: [],
      unproven: [
        "not-proven {*} — корень: писатель пересылает поля вне формы (unknownFields: 'keep'), а читатель проверяет лишние поля как число",
      ],
      notes: [],
    },
  ],
  [
    'unchecked: против строгого',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'reject' },
    { writerExtraFields: 'unchecked' },
    {
      violations: [
        'open-to-strict {*} — корень: писатель — тип TypeScript: поля вне формы ничто не отвергает, строгий читатель отвергнет сообщение с ними',
      ],
      unproven: [],
      notes: [],
    },
  ],
  [
    'unchecked: против strip',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    { writerExtraFields: 'unchecked' },
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'unchecked: объявленно открытый писатель — политика не добавляет находок',
    {
      kind: 'object',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
      unknownKeys: 'keep',
      rest: { kind: 'string' },
    },
    {
      kind: 'object',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
      unknownKeys: 'keep',
      rest: { kind: 'string' },
    },
    { writerExtraFields: 'unchecked' },
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'unchecked: строгий писатель — лишнего не шлёт',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'reject' },
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'reject' },
    { writerExtraFields: 'unchecked' },
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'unchecked: против keep с типом',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {
      kind: 'object',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
      unknownKeys: 'keep',
      rest: { kind: 'number' },
    },
    { writerExtraFields: 'unchecked' },
    {
      violations: [],
      unproven: [
        'not-proven {*} — корень: писатель — тип TypeScript: поля вне формы ничто не отвергает, а читатель проверяет лишние поля как число',
      ],
      notes: [],
    },
  ],
  [
    'unchecked: против keep без типа',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {
      kind: 'object',
      fields: { a: { optional: false, shape: { kind: 'string' } } },
      unknownKeys: 'keep',
      rest: { kind: 'unknown' },
    },
    { writerExtraFields: 'unchecked' },
    { violations: [], unproven: [], notes: [] },
  ],
  [
    'unchecked: против необязательного поля',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'string' } } }, unknownKeys: 'strip' },
    {
      kind: 'object',
      fields: {
        a: { optional: false, shape: { kind: 'string' } },
        b: { optional: true, shape: { kind: 'number' } },
      },
      unknownKeys: 'strip',
    },
    { writerExtraFields: 'unchecked' },
    {
      violations: [],
      unproven: [
        'not-proven b — «b»: писатель — тип TypeScript: поля вне формы ничто не отвергает — поле с этим именем может прийти с любым значением, читатель ждёт число',
      ],
      notes: ['field-unsent b — «b»: читатель читает необязательное поле, а писатель его не кладёт'],
    },
  ],
  [
    'kept: против словаря',
    { kind: 'object', fields: { a: { optional: false, shape: { kind: 'number' } } }, unknownKeys: 'strip' },
    { kind: 'record', key: { kind: 'string' }, value: { kind: 'number' } },
    { writerExtraFields: 'kept' },
    {
      violations: [],
      unproven: [
        "not-proven {*} — корень: писатель пересылает поля вне формы (unknownFields: 'keep'), а читатель-словарь проверит каждое",
      ],
      notes: [],
    },
  ],
  [
    'sameSource: одинаковый непрозрачный',
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    { kind: 'opaque', reason: 'transform', upper: { kind: 'string' } },
    { sameSource: true },
    {
      violations: [],
      unproven: [],
      notes: [
        'not-proven  — корень: строка (transform) — в обеих версиях одинаково; изменение самой функции снимок не видит',
      ],
    },
  ],
  [
    'sameSource: разный непрозрачный',
    { kind: 'opaque', reason: 'refine', upper: { kind: 'string', maxLength: 3 } },
    { kind: 'opaque', reason: 'refine', upper: { kind: 'string' } },
    { sameSource: true },
    {
      violations: [],
      unproven: [
        'not-proven  — корень: читатель — строка (refine): что он примет из «строка», форма не выражает; совместимость не доказана',
      ],
      notes: [],
    },
  ],
  [
    'sameSource: непрозрачный, отличается только текст причины — тот же узел',
    { kind: 'opaque', reason: 'кодек (stringbool)', upper: { kind: 'string' } },
    { kind: 'opaque', reason: 'stringbool: кодек', upper: { kind: 'string' } },
    { sameSource: true },
    {
      violations: [],
      unproven: [],
      notes: [
        'not-proven  — корень: строка (stringbool: кодек) — в обеих версиях одинаково; изменение самой функции снимок не видит',
      ],
    },
  ],
];

describe('compareShapes: точные находки', () => {
  it.each(CASES)('%s', (_name, writer, reader, options, expected) => {
    const result = compareShapes(writer, reader, { contract: 'c', mode: 'compatible', ...options });
    const line = (finding: { code: string; path: string; message: string }): string =>
      `${finding.code} ${finding.path} — ${finding.message}`;
    expect({
      violations: result.violations.map(line),
      unproven: result.unproven.map(line),
      notes: result.notes.map(line),
    }).toEqual(expected);
  });
});
