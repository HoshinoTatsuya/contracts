import { z } from 'zod';

import { compareShapes } from '../compare/compare-shapes';
import { diffShapes } from '../compare/diff-shapes';
import { canonicalShape } from '../shape/canonical-shape';
import type { Shape } from '../types/shape.type';
import { formatDescriptor } from './format-descriptor';
import { shapeFromZod } from './shape-from-zod';

/**
 * Снятие формы с zod там, где запись раньше теряла смысл или приносила лишнее:
 * выражение формата (разное у миноров zod), единица длины строки, проверки
 * цепочки в записи формата, условие `when`, свой `stringFormat`, нормализация
 * (`trim`, `toLowerCase`) и подстановка по умолчанию, `z.json()`, `pipe` и
 * `coerce`, пересечение с `catchall`, исключающее объединение.
 *
 * Где возможно, вердикт сверки проверяется против настоящего разбора zod.
 */
const verdictOf = (writer: z.ZodType, reader: z.ZodType, mode: 'compatible' | 'aligned' = 'compatible') => {
  const outcome = compareShapes(shapeFromZod(writer), shapeFromZod(reader), { contract: 'c', mode });
  return outcome.violations.length > 0
    ? 'нарушение'
    : outcome.unproven.length > 0
      ? 'не доказано'
      : 'совместимо';
};
const shapeVerdict = (writer: Shape, reader: Shape) => {
  const outcome = compareShapes(writer, reader, { contract: 'c', mode: 'compatible' });
  return outcome.violations.length > 0
    ? 'нарушение'
    : outcome.unproven.length > 0
      ? 'не доказано'
      : 'совместимо';
};
const accepts = (schema: z.ZodType, value: unknown): boolean =>
  schema.safeParse(JSON.parse(JSON.stringify(value))).success;

describe('формат: выражение и проверки цепочки', () => {
  it('выражение формата по умолчанию — в записи (у миноров zod оно разное)', () => {
    const shape = shapeFromZod(z.ulid()) as unknown as { formats: string[] };
    expect(shape.formats).toHaveLength(1);
    expect(shape.formats[0]).toMatch(/^ulid\{"pattern":"\/\^/);
  });

  it('один формат с разным выражением у сторон — «не доказано», а не «совместимо»', () => {
    const writer: Shape = { kind: 'string', formats: ['ulid{"pattern":"/^[0-9A-Z]{26}$/"}'] };
    const reader: Shape = { kind: 'string', formats: ['ulid{"pattern":"/^[0-7][0-9A-Z]{25}$/"}'] };
    expect(shapeVerdict(writer, reader)).toBe('не доказано');
    expect(shapeVerdict(writer, writer)).toBe('совместимо');
    // Другой формат — по-прежнему нарушение.
    expect(shapeVerdict({ kind: 'string', formats: ['cuid{"pattern":"/x/"}'] }, reader)).toBe('нарушение');
  });

  it('формат, который zod проверяет функцией, несёт версию zod', () => {
    const url = shapeFromZod(z.url()) as unknown as { formats: string[] };
    const version = (
      z.string() as unknown as { _zod: { version: { major: number; minor: number; patch: number } } }
    )._zod.version;
    expect(url.formats).toEqual([`url{"zod":"${version.major}.${version.minor}.${version.patch}"}`]);
    expect(
      shapeVerdict(
        { kind: 'string', formats: ['url{"zod":"4.4.3"}'] },
        { kind: 'string', formats: ['url{"zod":"4.6.5"}'] },
      ),
    ).toBe('не доказано');
  });

  it('проверки цепочки (max, length) не утекают в запись формата', () => {
    const shape = shapeFromZod(z.email().max(255).min(3)) as unknown as {
      formats: string[];
      maxLength: number;
      minLength: number;
    };
    expect(shape.formats).toHaveLength(1);
    expect(shape.formats[0]).not.toMatch(/checks/);
    expect([shape.minLength, shape.maxLength]).toEqual([3, 255]);
    // Писатель строже читателя — совместимо (было: «формат email{"checks":[{}]}, которого нет у писателя»).
    expect(verdictOf(z.email().max(255), z.email())).toBe('совместимо');
    expect(verdictOf(z.uuid().length(36), z.uuid())).toBe('совместимо');
    expect(verdictOf(z.url().max(2048), z.url())).toBe('совместимо');
    expect(verdictOf(z.email(), z.email().max(255))).toBe('нарушение');
  });

  it('строки писателя проверяются выражением формата читателя', () => {
    expect(verdictOf(z.enum(['x']), z.uuid())).toBe('нарушение');
    expect(verdictOf(z.enum(['00000000-0000-0000-0000-000000000000']), z.uuid())).toBe('совместимо');
    expect(verdictOf(z.enum(['https://a.example']), z.url())).toBe('не доказано');
  });

  it('свой stringFormat со встроенным именем не равен встроенному формату', () => {
    const fn = shapeFromZod(z.stringFormat('uuid', () => true));
    expect(fn.kind).toBe('opaque');
    expect(
      verdictOf(
        z.stringFormat('uuid', () => true),
        z.uuid(),
      ),
    ).not.toBe('совместимо');
    expect(accepts(z.uuid(), 'not-a-uuid')).toBe(false);
    expect(verdictOf(z.stringFormat('email', /.*/), z.email())).not.toBe('совместимо');
  });

  it('параметр-функция формата — opaque и не попадает в запись', () => {
    const tx = (): number => 1;
    expect(formatDescriptor({ type: 'string', check: 'string_format', format: 'email', tx })).toEqual({
      format: 'email',
      opaque: true,
    });
    expect(
      formatDescriptor({ type: 'string', check: 'string_format', format: 'email', marker: Symbol('m') }),
    ).toEqual({ format: 'email', opaque: true });
  });
});

describe('длина строки: единицы UTF-16 или кодовые точки', () => {
  it('установленный zod считает длину так, как записано в снимке', () => {
    const schema = z.string().min(3);
    const shape = shapeFromZod(schema) as { codePoints?: true };
    const twoEmoji = '\u{1F600}\u{1F600}';
    // 4 единицы UTF-16 и 2 кодовые точки: min(3) принимает только при счёте единицами.
    expect(shape.codePoints === true).toBe(!schema.safeParse(twoEmoji).success);
  });

  it('писатель считает единицами, читатель кодовыми точками — граница пересчитывается', () => {
    const units = (bounds: { minLength?: number; maxLength?: number }): Shape => ({
      kind: 'string',
      ...bounds,
    });
    const points = (bounds: { minLength?: number; maxLength?: number }): Shape => ({
      kind: 'string',
      ...bounds,
      codePoints: true,
    });
    // «😀😀» — 4 единицы и 2 точки: писатель min(3) единицами его шлёт, читатель min(3) точками отвергает.
    expect(shapeVerdict(units({ minLength: 3 }), points({ minLength: 3 }))).toBe('нарушение');
    expect(shapeVerdict(units({ minLength: 6 }), points({ minLength: 3 }))).toBe('совместимо');
    // max: точек не больше единиц.
    expect(shapeVerdict(units({ maxLength: 3 }), points({ maxLength: 3 }))).toBe('совместимо');
    // Писатель max(2) точками шлёт «😀😀» (4 единицы) — читатель max(3) единицами отвергает.
    expect(shapeVerdict(points({ maxLength: 2 }), units({ maxLength: 3 }))).toBe('нарушение');
    expect(shapeVerdict(points({ maxLength: 2 }), units({ maxLength: 4 }))).toBe('совместимо');
    expect(shapeVerdict(points({ minLength: 3 }), units({ minLength: 3 }))).toBe('совместимо');
  });

  it('строки писателя меряются единицей читателя', () => {
    const emoji = '\u{1F600}';
    expect(
      shapeVerdict({ kind: 'enum', values: [emoji] }, { kind: 'string', maxLength: 1, codePoints: true }),
    ).toBe('совместимо');
    expect(shapeVerdict({ kind: 'enum', values: [emoji] }, { kind: 'string', maxLength: 1 })).toBe(
      'нарушение',
    );
  });
});

describe('условие when: проверка применяется не всегда', () => {
  it('строка, число и массив: граница приёма — без условной проверки', () => {
    expect(verdictOf(z.string().min(5, { when: () => false } as never), z.string().min(5))).not.toBe(
      'совместимо',
    );
    expect(accepts(z.string().min(5, { when: () => false } as never), 'a')).toBe(true);
    expect(verdictOf(z.number().min(5, { when: () => false } as never), z.number().min(5))).not.toBe(
      'совместимо',
    );
    expect(
      verdictOf(z.array(z.number()).min(2, { when: () => false } as never), z.array(z.number()).min(2)),
    ).not.toBe('совместимо');
  });

  it('контроль: умолчание zod у проверок длины условием не считается', () => {
    expect(shapeFromZod(z.string().min(5))).toEqual(
      canonicalShape({
        kind: 'string',
        minLength: 5,
        ...(shapeFromZod(z.string().min(5)) as object),
      } as Shape),
    );
    expect(shapeFromZod(z.string().min(5)).kind).toBe('string');
    expect(verdictOf(z.string().min(5), z.string().min(5))).toBe('совместимо');
    // Условная проверка у читателя: писатель, укладывающийся в неё, — совместимо (принято наверняка).
    expect(verdictOf(z.string().min(5), z.string().min(5, { when: () => true } as never))).toBe('совместимо');
  });
});

describe('нормализация и значение по умолчанию: приём точный, зеркало видит выход', () => {
  const reference = (schema: z.ZodType, values: readonly string[]) =>
    values.map((value) => schema.safeParse(value).success);

  it('trim().min(n)/max(n)/length(n) — точный шаблон на вход, совпадающий с разбором zod', () => {
    const values = [
      '',
      ' ',
      '  a ',
      'a',
      ' ab ',
      '\tabc\n',
      'a b',
      '  ',
      '\u{1F600}',
      ' \u{1F600}\u{1F600} ',
      'abcd',
    ];
    for (const schema of [
      z.string().trim().min(1),
      z.string().trim().min(2),
      z.string().trim().min(3),
      z.string().trim().max(0),
      z.string().trim().max(1),
      z.string().trim().max(2),
      z.string().trim().length(2),
      z.string().min(1).trim().max(3),
    ]) {
      const shape = shapeFromZod(schema) as { kind: string; upper: Shape; exact?: true };
      expect(shape.kind).toBe('opaque');
      expect(shape.exact).toBe(true);
      const writer = (value: string): boolean =>
        shapeVerdict({ kind: 'enum', values: [value] }, shape as unknown as Shape) === 'совместимо';
      expect(values.map(writer)).toEqual(reference(schema, values));
    }
  });

  it('одинаковая встроенная нормализация у сторон — совместимо (trim, toLowerCase, pipe в email)', () => {
    const idioms = [
      () => z.object({ a: z.string().trim().min(1) }),
      () => z.object({ a: z.string().trim().toLowerCase().pipe(z.email()) }),
      () => z.object({ a: z.email().toLowerCase() }),
      () =>
        z.object({
          a: z
            .string()
            .toLowerCase()
            .regex(/^[a-z]+$/),
        }),
      () => z.object({ a: z.coerce.number().min(1) }),
      () => z.object({ a: z.coerce.date() }),
      () => z.object({ a: z.string().default('x') }),
    ];
    for (const make of idioms) {
      expect(verdictOf(make(), make())).toBe('совместимо');
      expect(verdictOf(make(), make(), 'aligned')).toBe('совместимо');
      expect(diffShapes(shapeFromZod(make()), shapeFromZod(make()), { contract: 'c' })).toEqual([]);
    }
  });

  it('разная нормализация у сторон — не совместимо (toUpperCase против toLowerCase)', () => {
    expect(
      verdictOf(
        z
          .string()
          .toLowerCase()
          .regex(/^[a-z]+$/),
        z
          .string()
          .toUpperCase()
          .regex(/^[a-z]+$/),
      ),
    ).not.toBe('совместимо');
    expect(
      accepts(
        z
          .string()
          .toUpperCase()
          .regex(/^[a-z]+$/),
        'a',
      ),
    ).toBe(false);
  });

  it('зеркало: default с разным значением и trim против без trim — различие', () => {
    const differences = (left: z.ZodType, right: z.ZodType): string[] =>
      diffShapes(shapeFromZod(left), shapeFromZod(right), { contract: 'c' }).map((finding) => finding.code);
    expect(
      differences(z.object({ p: z.string().default('low') }), z.object({ p: z.string().default('high') })),
    ).toEqual(['mirror-difference']);
    expect(differences(z.object({ a: z.string().trim() }), z.object({ a: z.string() }))).toEqual([
      'mirror-difference',
    ]);
    expect(
      differences(z.object({ p: z.string().default('low') }), z.object({ p: z.string().default('low') })),
    ).toEqual([]);
    // Функция по умолчанию: одинаковые копии не доказывают одинаковый выход.
    const random = () => z.object({ id: z.string().default(() => String(Math.random())) });
    expect(differences(random(), random())).toEqual(['not-proven']);
    // Сверка приёма от этого не шумит.
    expect(verdictOf(random(), random())).toBe('совместимо');
  });

  it('проверка после toUpperCase не переносится на вход (ß → SS удлиняет строку)', () => {
    const reader = z.string().toUpperCase().pipe(z.string().max(1));
    expect(accepts(reader, 'ß')).toBe(false);
    expect(verdictOf(z.string().max(1), reader)).not.toBe('совместимо');
  });

  it('coerce на входе pipe: выходная схема видит приведённое значение (причина называет это)', () => {
    const shape = shapeFromZod(z.coerce.number().pipe(z.number().min(5))) as { kind: string; reason: string };
    expect(shape.kind).toBe('opaque');
    expect(shape.reason).toMatch(/преобразованный вход/);
    expect(verdictOf(z.number().min(5), z.coerce.number().pipe(z.number().min(5)))).not.toBe('нарушение');
  });

  it('pipe в схему, которая ничего не проверяет, — приём как у входа', () => {
    expect(
      shapeFromZod(
        z
          .string()
          .min(2)
          .pipe(z.unknown() as never),
      ),
    ).toEqual(shapeFromZod(z.string().min(2)));
  });
});

describe('прочие узлы', () => {
  it('z.json() — любое значение JSON, а не отказ «рекурсивная схема»', () => {
    const shape = shapeFromZod(z.object({ a: z.json() })) as {
      fields: Record<string, { optional: boolean; shape: Shape }>;
    };
    expect(shape.fields.a).toEqual({ optional: false, shape: { kind: 'unknown' } });
    // Настоящая рекурсия — по-прежнему отказ.
    const Tree: z.ZodType = z.lazy(() => z.object({ children: z.array(Tree) }));
    expect(() => shapeFromZod(Tree)).toThrow('рекурсивная схема');
  });

  it('lt(5).lt(3) — граница 3 (строже), а не 5', () => {
    expect(shapeFromZod(z.number().lt(5).lt(3))).toEqual({ kind: 'number', exclusiveMaximum: 3 });
  });

  it('пересечение: поле одной части против catchall другой — opaque, факт — отказ', () => {
    const reader = z.intersection(z.object({ a: z.string() }), z.object({}).catchall(z.number()));
    expect(shapeFromZod(reader).kind).toBe('opaque');
    expect(accepts(reader, { a: 'x' })).toBe(false);
    expect(verdictOf(z.object({ a: z.string() }), reader)).not.toBe('совместимо');
    // Контроль: одинаковый catchall — точная форма.
    expect(
      shapeFromZod(z.intersection(z.object({ a: z.number() }), z.object({}).catchall(z.number()))).kind,
    ).toBe('object');
  });

  it('xor: метка необязательна у обоих вариантов — варианты пересекаются (opaque)', () => {
    const optionalTag = z.xor([
      z.object({ k: z.literal('a').optional(), x: z.string().optional() }),
      z.object({ k: z.literal('b').optional(), y: z.string().optional() }),
    ]);
    expect(shapeFromZod(optionalTag).kind).toBe('opaque');
    expect(optionalTag.safeParse({}).success).toBe(false);
    const requiredTag = z.xor([z.object({ k: z.literal('a') }), z.object({ k: z.literal('b') })]);
    expect(shapeFromZod(requiredTag).kind).toBe('union');
  });
});

describe('объединение с «что угодно»: приём — что угодно, выход зависит от вариантов', () => {
  const du = (tag: string) =>
    z.union([
      z.discriminatedUnion('k', [z.object({ k: z.literal(tag), v: z.string().optional() })]),
      z.unknown(),
    ]);
  const codes = (left: z.ZodType, right: z.ZodType): string[] =>
    diffShapes(shapeFromZod(left), shapeFromZod(right), { contract: 'c' }).map((finding) => finding.code);

  it('зеркало видит разные варианты-объекты (выход другой), одинаковые — без различий', () => {
    expect(du('p').parse({ k: 'p', d: 7 })).toEqual({ k: 'p' });
    expect(du('x').parse({ k: 'p', d: 7 })).toEqual({ k: 'p', d: 7 });
    expect(codes(du('p'), du('x'))).toEqual(['mirror-difference']);
    expect(codes(du('p'), du('p'))).toEqual([]);
    // Приём — что угодно: сверка по направлению не шумит.
    expect(verdictOf(z.string(), du('p'))).toBe('совместимо');
  });

  it('член кортежа unknown().optional() и unknown() — разные копии', () => {
    expect(
      codes(z.tuple([z.unknown().optional()], z.boolean()), z.tuple([z.unknown()], z.boolean())),
    ).toContain('mirror-difference');
  });
});
