import { z } from 'zod';

import type { Finding } from '../types/finding.type';
import { shapeFromZod } from '../zod/shape-from-zod';
import { compareShapes } from './compare-shapes';
import { diffShapes } from './diff-shapes';

/**
 * Таблица: изменение схемы × направление × ожидаемый вердикт.
 *
 * «Меняется писатель» — новая форма писателя против прежней формы читателя
 * (что сломает читателя старой версии); «меняется читатель» — прежняя форма
 * писателя против новой формы читателя (что сломает писателя старой версии).
 * Ожидание — ровно список `код путь` нарушений, а не «есть хоть одно»: лишнее
 * нарушение так же неверно, как пропущенное.
 */
const fields = {
  id: z.string(),
  proto: z.enum(['http', 'https']),
  port: z.number().int(),
  meta: z.object({ code: z.number() }).optional(),
  tags: z.array(z.string()),
};
const BASE = z.object(fields);

const verdict = (writer: z.ZodType, reader: z.ZodType, mode: 'compatible' | 'aligned' = 'compatible') => {
  const outcome = compareShapes(shapeFromZod(writer), shapeFromZod(reader), { contract: 't', mode });
  const codes = (findings: readonly Finding[]): string[] =>
    findings.map((finding) => `${finding.code} ${finding.path}`).sort();
  return {
    violations: codes(outcome.violations),
    notes: codes(outcome.notes),
    messages: outcome.violations.map((f) => f.message),
  };
};

interface Row {
  readonly change: string;
  readonly next: z.ZodType;
  /** Нарушения при «меняется писатель» (новая версия пишет → прежняя читает). */
  readonly writerChanged: readonly string[];
  /** Нарушения при «меняется читатель» (прежняя версия пишет → новая читает). */
  readonly readerChanged: readonly string[];
  /** Режим зеркала краснеет на любом изменении формы. */
  readonly mirror: boolean;
}

const ROWS: readonly Row[] = [
  {
    change: 'без изменений',
    next: z.object({ ...fields }),
    writerChanged: [],
    readerChanged: [],
    mirror: false,
  },
  {
    change: 'порядок полей и запись набора строк другие',
    next: z.object({
      tags: fields.tags,
      port: fields.port,
      proto: z.union([z.literal('https'), z.literal('http')]),
      meta: fields.meta,
      id: fields.id,
    }),
    writerChanged: [],
    readerChanged: [],
    mirror: false,
  },
  {
    change: 'добавлено необязательное поле',
    next: z.object({ ...fields, trace: z.string().optional() }),
    writerChanged: [],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'добавлено обязательное поле',
    next: z.object({ ...fields, trace: z.string() }),
    writerChanged: [],
    readerChanged: ['field-required-missing trace'],
    mirror: true,
  },
  {
    change: 'добавлено поле со значением по умолчанию',
    next: z.object({ ...fields, retries: z.number().default(3) }),
    writerChanged: [],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'удалено обязательное поле',
    next: z.object({ proto: fields.proto, port: fields.port, meta: fields.meta, tags: fields.tags }),
    writerChanged: ['field-required-missing id'],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'удалено необязательное поле',
    next: z.object({ id: fields.id, proto: fields.proto, port: fields.port, tags: fields.tags }),
    writerChanged: [],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'обязательное стало необязательным',
    next: z.object({ ...fields, id: z.string().optional() }),
    writerChanged: ['field-may-be-missing id'],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'необязательное стало обязательным',
    next: z.object({ ...fields, meta: z.object({ code: z.number() }) }),
    writerChanged: [],
    readerChanged: ['field-may-be-missing meta'],
    mirror: true,
  },
  {
    change: 'сменился тип поля',
    next: z.object({ ...fields, port: z.string() }),
    writerChanged: ['type-changed port'],
    readerChanged: ['type-changed port'],
    mirror: true,
  },
  {
    change: 'набор строк на проводе расширен',
    next: z.object({ ...fields, proto: z.enum(['http', 'https', 'ftp']) }),
    writerChanged: ['wire-value-unknown proto'],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'набор строк на проводе сужен',
    next: z.object({ ...fields, proto: z.enum(['https']) }),
    writerChanged: [],
    readerChanged: ['wire-value-unknown proto'],
    mirror: true,
  },
  {
    change: 'набор строк заменён свободной строкой',
    next: z.object({ ...fields, proto: z.string() }),
    writerChanged: ['wire-value-unknown proto'],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'поле переименовано',
    next: z.object({
      taskId: fields.id,
      proto: fields.proto,
      port: fields.port,
      meta: fields.meta,
      tags: fields.tags,
    }),
    writerChanged: ['field-required-missing id'],
    readerChanged: ['field-required-missing taskId'],
    mirror: true,
  },
  {
    change: 'целое стало дробным',
    next: z.object({ ...fields, port: z.number() }),
    writerChanged: ['constraint-narrowed port'],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'добавлен диапазон',
    next: z.object({ ...fields, port: z.number().int().min(1).max(65535) }),
    writerChanged: [],
    readerChanged: ['constraint-narrowed port'],
    mirror: true,
  },
  {
    change: 'удалено вложенное обязательное поле',
    next: z.object({ ...fields, meta: z.object({}).optional() }),
    writerChanged: ['field-required-missing meta.code'],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'элемент массива сменил тип',
    next: z.object({ ...fields, tags: z.array(z.number()) }),
    writerChanged: ['type-changed tags[]'],
    readerChanged: ['type-changed tags[]'],
    mirror: true,
  },
  {
    change: 'поле стало допускать null',
    next: z.object({ ...fields, id: z.string().nullable() }),
    writerChanged: ['type-changed id'],
    readerChanged: [],
    mirror: true,
  },
  {
    change: 'объект стал строгим',
    next: z.strictObject({ ...fields }),
    writerChanged: [],
    readerChanged: [],
    mirror: true,
  },
];

describe('совместимость по направлению: таблица изменений', () => {
  it.each(ROWS)('$change: меняется писатель', ({ next, writerChanged }) => {
    expect(verdict(next, BASE).violations).toEqual([...writerChanged].sort());
  });

  it.each(ROWS)('$change: меняется читатель', ({ next, readerChanged }) => {
    expect(verdict(BASE, next).violations).toEqual([...readerChanged].sort());
  });

  it.each(ROWS)('$change: режим зеркала', ({ next, mirror }) => {
    const differences = diffShapes(shapeFromZod(BASE), shapeFromZod(next), { contract: 't' });
    expect(differences.length > 0).toBe(mirror);
  });

  it('выборка таблицы не выродилась: есть и зелёные, и красные строки в обоих направлениях', () => {
    expect(ROWS.filter((row) => row.writerChanged.length > 0).length).toBeGreaterThanOrEqual(8);
    expect(ROWS.filter((row) => row.readerChanged.length > 0).length).toBeGreaterThanOrEqual(7);
    expect(
      ROWS.filter((row) => row.writerChanged.length === 0 && row.readerChanged.length === 0).length,
    ).toBeGreaterThanOrEqual(4);
  });
});

describe('совместимость: то, что дойдёт, но потеряется', () => {
  const NEXT = z.object({ ...fields, trace: z.string().optional() });

  it('новое поле писателя у старого терпимого читателя — замечание, не нарушение', () => {
    expect(verdict(NEXT, BASE)).toMatchObject({ violations: [], notes: ['field-unread trace'] });
  });

  it('новое необязательное поле читателя у старого писателя — замечание', () => {
    expect(verdict(BASE, NEXT)).toMatchObject({ violations: [], notes: ['field-unsent trace'] });
  });

  it('режим aligned: и то и другое — нарушения', () => {
    expect(verdict(NEXT, BASE, 'aligned').violations).toEqual(['field-unread trace']);
    expect(verdict(BASE, NEXT, 'aligned').violations).toEqual(['field-unsent trace']);
  });

  it('aligned: читатель мягче писателя — можно, строже — нельзя', () => {
    const softer = z.object({ ...fields, id: z.string().optional() });
    expect(verdict(BASE, softer, 'aligned').violations).toEqual([]);
    expect(verdict(softer, BASE, 'aligned').violations).toEqual(['field-may-be-missing id']);
  });

  it('новое поле писателя у СТРОГОГО читателя — сообщение будет отвергнуто', () => {
    expect(verdict(NEXT, z.strictObject({ ...fields })).violations).toEqual(['field-rejected trace']);
  });

  it('открытый писатель у строгого читателя — нарушение, у открытого — сверка типов лишних полей', () => {
    const open = z.looseObject({ ...fields });
    expect(verdict(open, z.strictObject({ ...fields })).violations).toEqual(['open-to-strict {*}']);
    expect(
      verdict(z.object({ ...fields }).catchall(z.string()), z.object({ ...fields }).catchall(z.number()))
        .violations,
    ).toEqual(['type-changed {*}']);
    expect(verdict(open, BASE)).toMatchObject({ violations: [], notes: ['field-unread {*}'] });
  });

  it('переименование подсказывается в тексте', () => {
    const renamed = z.object({
      taskId: fields.id,
      proto: fields.proto,
      port: fields.port,
      meta: fields.meta,
      tags: fields.tags,
    });
    expect(verdict(renamed, BASE).messages.join('\n')).toContain('похоже на переименование «id» ↔ «taskId»');
  });
});

describe('совместимость: объединения и варианты', () => {
  const variant = (kind: string, payload: z.ZodType) => z.object({ kind: z.literal(kind), payload });
  const OLD = z.discriminatedUnion('kind', [
    variant('found', z.array(z.string())),
    variant('done', z.object({ ok: z.boolean() })),
  ]);

  it('новый вариант у писателя — читатель его не знает', () => {
    const next = z.discriminatedUnion('kind', [
      variant('found', z.array(z.string())),
      variant('done', z.object({ ok: z.boolean() })),
      variant('skipped', z.object({})),
    ]);
    expect(verdict(next, OLD).violations).toEqual(['wire-value-unknown kind']);
    expect(verdict(OLD, next).violations).toEqual([]);
  });

  it('поле внутри варианта сменило тип — путь внутри варианта', () => {
    const next = z.discriminatedUnion('kind', [
      variant('found', z.array(z.number())),
      variant('done', z.object({ ok: z.boolean() })),
    ]);
    expect(verdict(next, OLD).violations).toEqual(['type-changed payload[]']);
  });

  it('вариант без пары вида у читателя — union-option-unmatched', () => {
    expect(verdict(z.union([z.string(), z.number()]), z.union([z.string(), z.boolean()])).violations).toEqual(
      ['union-option-unmatched '],
    );
  });

  it('литерал разошёлся, кортеж короче, читатель unknown принимает всё', () => {
    expect(verdict(z.literal(1), z.literal(2)).violations).toEqual(['literal-changed ']);
    expect(verdict(z.tuple([z.string()]), z.tuple([z.string(), z.number()])).violations).toEqual([
      'tuple-length [1]',
    ]);
    expect(verdict(z.object({ a: z.number() }), z.unknown()).violations).toEqual([]);
    expect(verdict(z.unknown(), z.string()).violations).toEqual(['type-changed ']);
  });

  it('строка короче потолка читателя проходит, длиннее — нет; шаблон и формат читателя — сужение', () => {
    expect(verdict(z.string().max(10), z.string().max(20)).violations).toEqual([]);
    expect(verdict(z.string().max(20), z.string().max(10)).violations).toEqual(['constraint-narrowed ']);
    expect(verdict(z.string(), z.string().regex(/^a/)).violations).toEqual(['constraint-narrowed ']);
    expect(verdict(z.string(), z.email()).violations).toEqual(['constraint-narrowed ']);
    expect(verdict(z.enum(['ab', 'ac']), z.string().regex(/^a/)).violations).toEqual([]);
    expect(verdict(z.enum(['ab', 'b']), z.string().regex(/^a/)).violations).toEqual(['constraint-narrowed ']);
  });

  it('словарь: тип значений и ключей сверяется', () => {
    expect(verdict(z.record(z.string(), z.number()), z.record(z.string(), z.string())).violations).toEqual([
      'type-changed {*}',
    ]);
    expect(verdict(z.object({ a: z.number() }), z.record(z.string(), z.number())).violations).toEqual([]);
  });
});
