import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { ContractDefinitionError } from '../errors/contract-definition.error';
import { describeThrown } from '../runtime/describe-thrown';
import { validateStandard } from '../runtime/validate-standard';
import { canonicalShape } from '../shape/canonical-shape';
import { determined } from '../shape/determined';
import { exactShape } from '../shape/exact-shape';
import { isMultiple } from '../shape/is-multiple';
import { opaqueShape } from '../shape/opaque-shape';
import { optionsDisjoint } from '../shape/options-disjoint';
import { patternLiteral } from '../shape/pattern-literal';
import { setOwn } from '../shape/set-own';
import { shapeKey } from '../shape/shape-key';
import { stableJson } from '../shape/stable-json';
import { withoutUndefined } from '../shape/without-undefined';
import type { FieldShape } from '../types/field-shape.type';
import type { Shape } from '../types/shape.type';
import type { ShapeOf } from '../types/shape-of.type';
import type { ZodDef as Def } from '../types/zod-def.type';
import { formatDescriptor } from './format-descriptor';

/**
 * Форма на проводе по схеме Zod 4 — обход `_zod.def`, без импорта zod.
 *
 * Описывается ВХОД. То, что форма не выражает, не превращается ни в «что
 * угодно», ни в молчаливый пропуск, а становится `opaque` с границами:
 *
 * - `coerce` — принимает что угодно, наверняка — значения своего типа в своих
 *   ограничениях (на них приведение — тождество);
 * - `catch` — принимает что угодно, но значение вне внутренней схемы молча
 *   заменяется запасным; наверняка «понято так же» — внутренняя схема;
 * - `preprocess`, `transform`, выход `pipe` после преобразования, кодеки
 *   (`stringbool`), `refine`/`superRefine`, проверка после `trim`/
 *   `toLowerCase`, функция формата, `xor` с пересекающимися вариантами,
 *   `looseRecord`, пересечение объектов с `catchall` — граница сверху,
 *   наверняка — ничего;
 * - `pipe` без преобразований между простыми типами — ограничения складываются.
 *
 * Обязательность поля — как у установленного zod НА ДЕЛЕ: объект разбирается
 * пустым, и поле без отклонения по своему пути необязательно. Внутренние флаги
 * (`optin`) меняются от минора к минору, поведение — тоже, и снимок обязан
 * описывать поведение. `record` с конечным набором ключей (`z.enum`) —
 * объект: zod 4 требует каждый ключ и отвергает чужие.
 *
 * Вид без формы на проводе (функция, промис, Map, Set, symbol, NaN, `custom`),
 * рекурсия через `lazy` и вложенность глубже `CONTRACT_FORMAT.MAX_SHAPE_DEPTH`
 * — отказ `ContractDefinitionError` с путём.
 */
export function shapeFromZod(schema: unknown, contract = 'контракт'): Shape {
  const active = new Set<unknown>();
  let depth = 0;

  const defOf = (node: unknown, path: string): Def => {
    const def = (node as { _zod?: { def?: Def } } | null)?._zod?.def;
    if (typeof def !== 'object' || def === null || typeof def.type !== 'string') {
      throw new ContractDefinitionError(
        contract,
        path,
        'не схема Zod 4: нет `_zod.def` (zod 3 не поддерживается)',
      );
    }
    return def;
  };

  const fail = (path: string, detail: string): never => {
    throw new ContractDefinitionError(contract, path, detail);
  };

  /** Экземпляр проверки по её описанию — чтобы узнать, чем формат отличается от своего умолчания. */
  const owners = new WeakMap<Def, unknown>();
  const checksOf = (def: Def, node?: unknown): Def[] => {
    if (typeof def.check === 'string' && node !== undefined) {
      owners.set(def, node);
    }
    const own = typeof def.check === 'string' ? [def] : [];
    const listed = Array.isArray(def.checks)
      ? (def.checks as unknown[]).map((check) => {
          const inner = (check as { _zod: { def: Def } })._zod.def;
          owners.set(inner, check);
          return inner;
        })
      : [];
    return [...own, ...listed].filter((check) => check !== undefined);
  };

  /** Причина, по которой проверка не входит в форму. */
  const foreign = (check: Def): string => {
    if (check.check === 'custom') {
      return 'refine';
    }
    return `проверка «${String(check.check)}»`;
  };

  const withReasons = (shape: Shape, reasons: readonly string[]): Shape =>
    reasons.length === 0 ? shape : opaqueShape([...new Set(reasons)].join('; '), shape);

  /**
   * Своё условие `when` у проверки: проверка применяется не всегда, поэтому
   * входит только в «принято наверняка», а не в границу приёма. Умолчание zod
   * у проверок длины («у значения есть длина») условием не считается.
   */
  const conditional = (check: Def): boolean => {
    if (typeof check.when !== 'function') {
      return false;
    }
    const text = Function.prototype.toString.call(check.when).replace(/\s+/g, ' ').trim();
    return !/^\(?payload\)? => \{ const val = payload\.value; return !util\.nullish\(val\) && val\.length !== undefined;? \}$/.test(
      text,
    );
  };

  /** Встроенная нормализация zod по тексту её функции; своя `overwrite(fn)` — `undefined`. */
  const overwriteName = (check: Def): string | undefined => {
    if (typeof check.tx !== 'function') {
      return undefined;
    }
    const text = Function.prototype.toString.call(check.tx).replace(/\s+/g, ' ').trim();
    const match = /^\(?input\)? => input\.(trim|toLowerCase|toUpperCase)\(\)$/.exec(text);
    return match?.[1];
  };

  /** Версия zod узла (`_zod.version`) — для форматов, которые zod проверяет функцией. */
  const versionOf = (node: unknown): string | undefined => {
    const version = (
      node as { _zod?: { version?: { major?: unknown; minor?: unknown; patch?: unknown } } } | null
    )?._zod?.version;
    return version === undefined
      ? undefined
      : `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
  };

  /**
   * Чем проверка длины строки считает длину — по ПОВЕДЕНИЮ самой проверки:
   * zod до 4.6 — единицами UTF-16 (`'😀'.length === 2`), с 4.6 — кодовыми
   * точками. `true` — кодовыми точками; `undefined` — не удалось узнать.
   * Граница, при которой единица не важна (`min(1)`, `max(0)`), — `false`.
   */
  const lengthInCodePoints = (check: Def): boolean | undefined => {
    const owner = owners.get(check) as { _zod?: { check?: unknown } } | undefined;
    const run = owner?._zod?.check;
    const bound = Number(check.minimum ?? check.maximum ?? check.length);
    const minimum = check.check === 'min_length';
    if (!Number.isFinite(bound) || (minimum ? bound < 2 : bound < 1)) {
      return false;
    }
    if (typeof run !== 'function') {
      return undefined;
    }
    const payload = {
      value: '\u{1F600}'.repeat(minimum ? Math.ceil(bound / 2) : bound),
      issues: [] as unknown[],
    };
    try {
      (run as (payload: unknown) => void).call(owner?._zod, payload);
    } catch {
      return undefined;
    }
    const accepted = payload.issues.length === 0;
    // min: единицы UTF-16 принимают, кодовые точки — нет; max и length — наоборот.
    return minimum ? !accepted : accepted;
  };

  /** Строка по списку проверок без нормализации: границы длины (с единицей), шаблоны, форматы. */
  const stringOf = (checks: readonly Def[], version: string | undefined): Shape => {
    let minLength: number | undefined;
    let maxLength: number | undefined;
    let codePoints = false;
    const patterns: string[] = [];
    const formats: string[] = [];
    const reasons: string[] = [];
    const unit = (check: Def): void => {
      const measured = lengthInCodePoints(check);
      if (measured === undefined) {
        reasons.push('единица длины строки не определена');
      } else if (measured) {
        codePoints = true;
      }
    };
    for (const check of checks) {
      switch (check.check) {
        case 'min_length':
          unit(check);
          minLength = Math.max(minLength ?? 0, Number(check.minimum));
          break;
        case 'max_length':
          unit(check);
          maxLength = Math.min(maxLength ?? Number.POSITIVE_INFINITY, Number(check.maximum));
          break;
        case 'length_equals':
          unit(check);
          minLength = Math.max(minLength ?? 0, Number(check.length));
          maxLength = Math.min(maxLength ?? Number.POSITIVE_INFINITY, Number(check.length));
          break;
        case 'string_format': {
          if (check.format === 'regex' && check.pattern instanceof RegExp) {
            patterns.push(patternLiteral(check.pattern.source, check.pattern.flags));
            break;
          }
          const descriptor = formatDescriptor(check, owners.get(check), version);
          formats.push(descriptor.format);
          if (descriptor.opaque) {
            reasons.push(`формат «${String(check.format)}» проверяется функцией`);
          }
          break;
        }
        default:
          reasons.push(foreign(check));
          break;
      }
    }
    return withReasons(
      {
        kind: 'string',
        ...(minLength === undefined ? {} : { minLength }),
        ...(maxLength === undefined ? {} : { maxLength }),
        patterns,
        formats,
        ...(codePoints && (minLength !== undefined || maxLength !== undefined)
          ? { codePoints: true as const }
          : {}),
      },
      reasons,
    );
  };

  /** Проверки с условием `when` — только в «принято наверняка»: граница приёма — без них. */
  const withConditions = (checks: readonly Def[], build: (checks: readonly Def[]) => Shape): Shape => {
    const unconditional = checks.filter((check) => !conditional(check));
    if (unconditional.length === checks.length) {
      return build(checks);
    }
    const full = canonicalShape(build(checks));
    return opaqueShape(
      'проверка с условием when: применяется не всегда',
      build(unconditional),
      full.kind === 'opaque' ? undefined : full,
    );
  };

  /**
   * Длина строки ПОСЛЕ `trim` — шаблоном на вход: `trim().min(1)` принимает
   * ровно строки с непробельным знаком. Пробельные знаки `\s` — те же, что
   * снимает `String.prototype.trim`; флаг `u` — длина в кодовых точках.
   */
  const trimmedLength = (check: Def): string[] | undefined => {
    const measured = lengthInCodePoints(check);
    if (measured === undefined) {
      return undefined;
    }
    const flags = measured ? 'u' : '';
    const atLeast = (n: number): string[] =>
      n <= 0 ? [] : [patternLiteral(n === 1 ? '\\S' : `^\\s*\\S[\\s\\S]{${n - 2},}\\S\\s*$`, flags)];
    const atMost = (n: number): string[] => [
      patternLiteral(
        n <= 0 ? '^\\s*$' : n === 1 ? '^\\s*\\S?\\s*$' : `^\\s*(?:\\S(?:[\\s\\S]{0,${n - 2}}\\S)?)?\\s*$`,
        flags,
      ),
    ];
    switch (check.check) {
      case 'min_length':
        return atLeast(Number(check.minimum));
      case 'max_length':
        return atMost(Number(check.maximum));
      case 'length_equals':
        return [...atLeast(Number(check.length)), ...atMost(Number(check.length))];
      default:
        return undefined;
    }
  };

  const stringShape = (node: unknown, def: Def): Shape => {
    const all = checksOf(def, node);
    const version = versionOf(node);
    const first = all.findIndex((check) => check.check === 'overwrite');
    const before = first < 0 ? all : all.slice(0, first);
    const input = withConditions(before, (checks) => stringOf(checks, version));
    if (first < 0) {
      return input;
    }
    // Нормализация (trim, toLowerCase…) и проверки после неё видят не вход, а результат.
    const after = all.slice(first);
    const names: string[] = [];
    const steps: string[] = [];
    let determined = canonicalShape(input).kind !== 'opaque';
    const post: Def[] = [];
    for (const check of after) {
      if (check.check === 'overwrite') {
        const name = overwriteName(check);
        determined &&= name !== undefined;
        names.push(name ?? 'overwrite');
        steps.push(name ?? 'overwrite(функция)');
      } else {
        const alone = canonicalShape(stringOf([check], version));
        determined &&= !conditional(check) && alone.kind !== 'opaque';
        post.push(check);
        steps.push(shapeKey(alone));
      }
    }
    const semantics = determined ? `после ${JSON.stringify(steps)}` : undefined;
    const reason = [...new Set(names)].join(', ');
    if (post.length === 0) {
      // Нормализация ничего не отвергает: приём прежний, меняется только выход.
      return exactShape(reason, input, semantics);
    }
    const lengthsAfterTrim =
      determined &&
      names.length === 1 &&
      names[0] === 'trim' &&
      after[0]?.check === 'overwrite' &&
      post.every(
        (check) =>
          check.check === 'min_length' || check.check === 'max_length' || check.check === 'length_equals',
      );
    const exactInput = canonicalShape(input);
    if (lengthsAfterTrim && exactInput.kind === 'string') {
      const patterns = post.map(trimmedLength);
      if (patterns.every((pattern) => pattern !== undefined)) {
        return exactShape(
          reason,
          { ...exactInput, patterns: [...(exactInput.patterns ?? []), ...(patterns as string[][]).flat()] },
          semantics,
        );
      }
    }
    if (exactInput.kind === 'opaque') {
      return opaqueShape(`проверка после ${reason}`, input);
    }
    return {
      kind: 'opaque',
      reason: `проверка после ${reason}`,
      upper: input,
      ...(semantics === undefined ? {} : { semantics }),
    };
  };

  /** Число по списку проверок без нормализации. */
  const numberOf = (checks: readonly Def[]): Shape => {
    const shape: {
      kind: 'number';
      integer?: true;
      minimum?: number;
      exclusiveMinimum?: number;
      maximum?: number;
      exclusiveMaximum?: number;
      multipleOf?: number;
    } = { kind: 'number' };
    const reasons: string[] = [];
    const lower = (value: number, inclusive: boolean): void => {
      if (inclusive) {
        shape.minimum = Math.max(shape.minimum ?? Number.NEGATIVE_INFINITY, value);
      } else {
        shape.exclusiveMinimum = Math.max(shape.exclusiveMinimum ?? Number.NEGATIVE_INFINITY, value);
      }
    };
    const upper = (value: number, inclusive: boolean): void => {
      if (inclusive) {
        shape.maximum = Math.min(shape.maximum ?? Number.POSITIVE_INFINITY, value);
      } else {
        shape.exclusiveMaximum = Math.min(shape.exclusiveMaximum ?? Number.POSITIVE_INFINITY, value);
      }
    };
    for (const check of checks) {
      switch (check.check) {
        case 'greater_than':
          lower(Number(check.value), check.inclusive === true);
          break;
        case 'less_than':
          upper(Number(check.value), check.inclusive === true);
          break;
        case 'multiple_of': {
          const value = Number(check.value);
          const current = shape.multipleOf;
          if (current === undefined || isMultiple(value, current)) {
            shape.multipleOf = value;
          } else if (!isMultiple(current, value)) {
            reasons.push('несколько multipleOf');
          }
          break;
        }
        case 'number_format': {
          const format = String(check.format);
          if (format === 'safeint') {
            shape.integer = true;
            lower(Number.MIN_SAFE_INTEGER, true);
            upper(Number.MAX_SAFE_INTEGER, true);
          } else if (format === 'int32') {
            shape.integer = true;
            lower(-2147483648, true);
            upper(2147483647, true);
          } else if (format === 'uint32') {
            shape.integer = true;
            lower(0, true);
            upper(4294967295, true);
          } else if (format === 'float32') {
            lower(-3.4028234663852886e38, true);
            upper(3.4028234663852886e38, true);
          } else if (format !== 'float64') {
            reasons.push(`формат числа «${format}»`);
          }
          break;
        }
        default:
          reasons.push(foreign(check));
          break;
      }
    }
    return withReasons(shape, reasons);
  };

  /**
   * Проверки после своей `overwrite(fn)` видят результат функции — на вход не
   * переносятся; без проверок после неё приём прежний, меняется только выход.
   */
  const overwritten = (input: Shape, after: readonly Def[]): Shape => {
    if (after.length === 0) {
      return input;
    }
    const post = after.filter((check) => check.check !== 'overwrite');
    return post.length === 0
      ? exactShape('overwrite', input)
      : opaqueShape('проверка после overwrite', input);
  };

  const numberShape = (def: Def): Shape => {
    const all = checksOf(def);
    const first = all.findIndex((check) => check.check === 'overwrite');
    const before = first < 0 ? all : all.slice(0, first);
    return overwritten(withConditions(before, numberOf), first < 0 ? [] : all.slice(first));
  };

  const arrayShape = (def: Def, path: string): Shape => {
    const all = checksOf(def);
    const first = all.findIndex((check) => check.check === 'overwrite');
    const before = first < 0 ? all : all.slice(0, first);
    const element = visit(def.element, `${path}[]`);
    const build = (checks: readonly Def[]): Shape => {
      let minItems: number | undefined;
      let maxItems: number | undefined;
      const reasons: string[] = [];
      for (const check of checks) {
        if (check.check === 'min_length') {
          minItems = Math.max(minItems ?? 0, Number(check.minimum));
        } else if (check.check === 'max_length') {
          maxItems = Math.min(maxItems ?? Number.POSITIVE_INFINITY, Number(check.maximum));
        } else if (check.check === 'length_equals') {
          minItems = Math.max(minItems ?? 0, Number(check.length));
          maxItems = Math.min(maxItems ?? Number.POSITIVE_INFINITY, Number(check.length));
        } else {
          reasons.push(foreign(check));
        }
      }
      return withReasons(
        {
          kind: 'array',
          element,
          ...(minItems === undefined ? {} : { minItems }),
          ...(maxItems === undefined ? {} : { maxItems }),
        },
        reasons,
      );
    };
    return overwritten(withConditions(before, build), first < 0 ? [] : all.slice(first));
  };

  /** Любая проверка у вида, который проверок формы не несёт (объект, объединение…), — `refine` и подобное. */
  const plainChecks = (shape: Shape, def: Def): Shape =>
    withReasons(
      shape,
      checksOf(def).map((check) => (check.check === 'overwrite' ? 'overwrite' : foreign(check))),
    );

  const literal = (value: unknown, path: string): Shape => {
    if (typeof value === 'string') {
      return { kind: 'enum', values: [value] };
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return { kind: 'literal', value };
    }
    if (value === null) {
      return { kind: 'null' };
    }
    if (value === undefined) {
      return { kind: 'undefined' };
    }
    return fail(path, `литерал без формы на проводе: ${typeof value}`);
  };

  /** Значения, которые схема принимает на деле (`_zod.values`): у числового нативного enum это числа, а не обратные имена. */
  const valuesOf = (node: unknown, fallback: readonly unknown[]): readonly unknown[] => {
    const values = (node as { _zod?: { values?: unknown } })._zod?.values;
    return values instanceof Set ? [...values] : fallback;
  };

  /** Тот же узел без своих проверок (`refine`/`superRefine`): разбор-проба видит только форму. */
  const withoutChecks = (node: unknown, def: Def): unknown => {
    const checks = def.checks;
    const Constructor = (node as { _zod?: { constr?: unknown } })._zod?.constr;
    return Array.isArray(checks) && checks.length > 0 && typeof Constructor === 'function'
      ? new (Constructor as new (def: unknown) => unknown)({ ...def, checks: [] })
      : node;
  };

  /**
   * Обязательность полей объекта (и словаря с конечным набором ключей) — по
   * ПОВЕДЕНИЮ установленного zod, двумя разборами:
   *
   * - `{}` — поле без отклонения по своему пути может отсутствовать
   *   (`optional`);
   * - все поля `undefined` — поле, которое отсутствовать не может, но
   *   принимает `undefined` (`z.unknown()`, `z.any()`, `union([…,
   *   z.undefined()])` с zod 4.4), — `undefinedAccepted`: писатель вправе
   *   положить `undefined`, по JSON поле пропадёт, а читатель его требует.
   *
   * Разбирается объект БЕЗ своих проверок (`refine`/`superRefine` объекта):
   * проверка «хотя бы одно из a/b» с `path: ['b']` иначе делала `b`
   * «обязательным», и граница `upper` переставала быть надмножеством.
   * Схема исполняется: `preprocess`/`transform`/`refine` полей видят
   * `undefined`. Разбор бросил исключение — поле за полем: поле, бросающее
   * на `undefined`, обязательно (читатель его отсутствие не переживёт).
   * Асинхронный разбор — отказ: контракт разбирается синхронно.
   */
  const fieldPresence = (
    node: unknown,
    def: Def,
    names: readonly string[],
    child: (name: string) => unknown,
    path: string,
  ): Map<string, { readonly optional: boolean; readonly undefinedAccepted: boolean }> | null => {
    if (typeof (node as { '~standard'?: { validate?: unknown } })['~standard']?.validate !== 'function') {
      return null;
    }
    // Проверки объекта (refine с path) не говорят, может ли поле отсутствовать: разбирается объект без них.
    const probe = withoutChecks(node, def);
    const rejected = (value: unknown): Set<string> | null => {
      const outcome = validateStandard(probe, value);
      if (outcome.kind === 'async') {
        return fail(
          path,
          'асинхронная схема (async refine/transform): обязательность полей не определить синхронно',
        );
      }
      if (outcome.kind === 'threw') {
        return null;
      }
      const keys = new Set<string>();
      for (const issue of outcome.kind === 'issues' ? outcome.issues : []) {
        if (issue.head !== undefined) {
          keys.add(issue.head);
        }
      }
      return keys;
    };
    const one = (name: string): boolean => {
      const outcome = validateStandard(child(name), undefined);
      if (outcome.kind === 'async') {
        return fail(
          path === '' ? name : `${path}.${name}`,
          'асинхронная схема (async refine/transform): обязательность поля не определить синхронно',
        );
      }
      return outcome.kind === 'value';
    };
    const absent = rejected({});
    const blank = rejected(Object.fromEntries(names.map((name) => [name, undefined])));
    const result = new Map<string, { readonly optional: boolean; readonly undefinedAccepted: boolean }>();
    for (const name of names) {
      const optional = absent === null ? one(name) : !absent.has(name);
      const takesUndefined = blank === null ? one(name) : !blank.has(name);
      result.set(name, { optional, undefinedAccepted: !optional && takesUndefined });
    }
    return result;
  };

  const objectShape = (node: unknown, def: Def, path: string): Shape => {
    const fields: Record<string, FieldShape> = {};
    const shape = def.shape as Record<string, unknown>;
    const presence = fieldPresence(node, def, Object.keys(shape), (name) => shape[name], path);
    for (const name of Object.keys(shape)) {
      const child = shape[name];
      const inner = withoutUndefined(visit(child, path === '' ? name : `${path}.${name}`));
      const optin = (child as { _zod?: { optin?: string } })._zod?.optin;
      const behaviour = presence?.get(name);
      setOwn(
        fields,
        name,
        behaviour === undefined
          ? {
              optional: optin === 'optional' || optin === 'defaulted' || inner.hadUndefined,
              shape: inner.shape,
            }
          : {
              optional: behaviour.optional,
              ...(behaviour.undefinedAccepted ? { undefinedAccepted: true as const } : {}),
              shape: inner.shape,
            },
      );
    }
    const catchall = def.catchall;
    if (catchall === undefined) {
      return { kind: 'object', fields, unknownKeys: 'strip' };
    }
    const rest = defOf(catchall, `${path}{*}`).type;
    if (rest === 'never') {
      return { kind: 'object', fields, unknownKeys: 'reject' };
    }
    return { kind: 'object', fields, unknownKeys: 'keep', rest: visit(catchall, `${path}{*}`) };
  };

  const recordShape = (node: unknown, def: Def, path: string): Shape => {
    const key = canonicalShape(visit(def.keyType, `${path}{key}`));
    const value = visit(def.valueType, `${path}{*}`);
    const loose = def.mode === 'loose';
    if (key.kind === 'enum') {
      // Конечный набор ключей: zod 4 требует каждый (кроме partialRecord) и отвергает чужие (кроме looseRecord).
      const presence = fieldPresence(node, def, key.values, () => def.valueType, path);
      const fields: Record<string, FieldShape> = {};
      const inner = withoutUndefined(value);
      for (const name of key.values) {
        const behaviour = presence?.get(name);
        setOwn(
          fields,
          name,
          behaviour === undefined
            ? { optional: def.partial === true, shape: inner.shape }
            : {
                optional: behaviour.optional,
                ...(behaviour.undefinedAccepted ? { undefinedAccepted: true as const } : {}),
                shape: inner.shape,
              },
        );
      }
      return loose
        ? { kind: 'object', fields, unknownKeys: 'keep', rest: { kind: 'unknown' } }
        : { kind: 'object', fields, unknownKeys: 'reject' };
    }
    if (loose) {
      return opaqueShape(
        'looseRecord: ключи вне схемы ключа проходят без проверки значения',
        { kind: 'record', key: { kind: 'string' }, value: { kind: 'unknown' } },
        { kind: 'record', key, value },
      );
    }
    return { kind: 'record', key, value };
  };

  const intersection = (def: Def, path: string): Shape => {
    const left = canonicalShape(visit(def.left, path));
    const right = canonicalShape(visit(def.right, path));
    if (left.kind !== 'object' || right.kind !== 'object') {
      return fail(path, 'пересечение не двух объектов: форма на проводе не выводится однозначно');
    }
    if (left.unknownKeys === 'reject' || right.unknownKeys === 'reject') {
      return fail(path, 'пересечение со строгим объектом отвергает поля второй части');
    }
    const fields: Record<string, FieldShape> = {};
    let lossy = false;
    const restOf = (side: ShapeOf<'object'>): Shape | undefined =>
      side.unknownKeys === 'keep' ? (side.rest ?? { kind: 'unknown' }) : undefined;
    for (const [own, other] of [
      [left, right],
      [right, left],
    ] as const) {
      for (const [name, field] of Object.entries(own.fields)) {
        const twin = Object.hasOwn(other.fields, name) ? other.fields[name] : undefined;
        if (twin !== undefined && stableJson(twin.shape) !== stableJson(field.shape)) {
          return fail(
            path === '' ? name : `${path}.${name}`,
            'поле в обеих частях пересечения с разной формой',
          );
        }
        // Поле одной части — лишнее для другой: при её catchall оно обязано пройти и его.
        const otherRest = restOf(other);
        if (
          twin === undefined &&
          otherRest !== undefined &&
          otherRest.kind !== 'unknown' &&
          stableJson(otherRest) !== stableJson(field.shape)
        ) {
          lossy = true;
        }
        const optional = field.optional && (twin?.optional ?? true);
        // Явное undefined пересечение принимает, только если его принимают обе части.
        const takes = (side: FieldShape | undefined): boolean =>
          side === undefined || side.optional || side.undefinedAccepted === true;
        setOwn(fields, name, {
          optional,
          ...(!optional && takes(field) && takes(twin) ? { undefinedAccepted: true as const } : {}),
          shape: field.shape,
        });
      }
    }
    const rests = [restOf(left), restOf(right)].filter((rest): rest is Shape => rest !== undefined);
    const typed = rests.filter((rest) => rest.kind !== 'unknown');
    if (new Set(typed.map((rest) => stableJson(rest))).size > 1) {
      lossy = true;
    }
    const merged: Shape =
      rests.length === 0
        ? { kind: 'object', fields, unknownKeys: 'strip' }
        : {
            kind: 'object',
            fields,
            unknownKeys: 'keep',
            rest: lossy ? { kind: 'unknown' } : (typed[0] ?? { kind: 'unknown' }),
          };
    return lossy ? opaqueShape('пересечение объектов с catchall', merged) : merged;
  };

  /**
   * Значение по умолчанию JSON-строкой, если оно постоянно: читается дважды
   * (у функции-умолчания вроде \`() => randomUUID()\` значения разные). Функция
   * или значение без записи в JSON — \`undefined\`: совпадение копий тогда не
   * доказывает одинаковый выход.
   */
  const defaultOf = (def: Def): string | undefined => {
    try {
      const first = stableJson(def.defaultValue);
      const second = stableJson(def.defaultValue);
      return first === undefined || first !== second ? undefined : first;
    } catch {
      return undefined;
    }
  };

  /**
   * Сколько членов кортеж требует на ДЕЛЕ: разбор массивов из `undefined`
   * длиной 0, 1, … — первая длина без отклонения в корне (длина короче
   * требуемой). Принимает ли член `undefined` и может ли он отсутствовать —
   * разное: `z.tuple([z.unknown()])` в zod 4.6 отвергает `[]`. Не удалось
   * узнать — `undefined` (длина — по необязательным последним членам).
   */
  const tupleRequired = (node: unknown, def: Def, length: number): number | undefined => {
    const probe = withoutChecks(node, def);
    for (let count = 0; count <= length; count += 1) {
      const outcome = validateStandard(probe, new Array<undefined>(count).fill(undefined));
      if (outcome.kind === 'async' || outcome.kind === 'threw') {
        return undefined;
      }
      // Отклонение члена, которого во входе НЕТ, или корня — длина короче требуемой; член, которому
      // досталось undefined, отклонён за значение, а не за длину.
      if (
        outcome.kind === 'value' ||
        outcome.issues.every((issue) => issue.head !== undefined && Number(issue.head) < count)
      ) {
        return count;
      }
    }
    return undefined;
  };

  /** Выход схемы равен её входу: простой вид без приведения, преобразования и overwrite. */
  const preserves = (node: unknown): boolean => {
    const def = (node as { _zod?: { def?: Def } } | null)?._zod?.def;
    if (def === undefined || def.coerce === true) {
      return false;
    }
    if (checksOf(def).some((check) => check.check === 'overwrite')) {
      return false;
    }
    switch (def.type) {
      case 'string':
      case 'number':
      case 'int':
      case 'boolean':
      case 'null':
      case 'literal':
      case 'enum':
      case 'template_literal':
      case 'unknown':
      case 'any':
        return true;
      case 'optional':
      case 'nullable':
      case 'readonly':
        return preserves(def.innerType);
      default:
        return false;
    }
  };

  /** Ограничения входа и выхода `pipe` над одним значением: складываются, если вид один и простой. */
  const piped = (input: Shape, output: Shape): Shape | null => {
    const a = canonicalShape(input);
    const b = canonicalShape(output);
    if (b.kind === 'unknown') {
      return a;
    }
    // Вход «что угодно» без преобразования: приём — ровно выходной схемы.
    if (a.kind === 'unknown') {
      return b;
    }
    if (a.kind === 'string' && b.kind === 'string') {
      const minLength = Math.max(a.minLength ?? 0, b.minLength ?? 0);
      const maxLength = Math.min(
        a.maxLength ?? Number.POSITIVE_INFINITY,
        b.maxLength ?? Number.POSITIVE_INFINITY,
      );
      return {
        kind: 'string',
        ...(minLength === 0 ? {} : { minLength }),
        ...(maxLength === Number.POSITIVE_INFINITY ? {} : { maxLength }),
        patterns: [...(a.patterns ?? []), ...(b.patterns ?? [])],
        formats: [...(a.formats ?? []), ...(b.formats ?? [])],
        // Один zod — одна единица длины: кодовые точки у любой стороны значат их у обеих.
        ...(a.codePoints === true || b.codePoints === true ? { codePoints: true as const } : {}),
      };
    }
    if (a.kind === 'number' && b.kind === 'number') {
      if (a.multipleOf !== undefined && b.multipleOf !== undefined && a.multipleOf !== b.multipleOf) {
        return null;
      }
      const pick = (
        x: number | undefined,
        y: number | undefined,
        choose: (p: number, q: number) => number,
      ) => (x === undefined ? y : y === undefined ? x : choose(x, y));
      const merged = {
        kind: 'number' as const,
        ...(a.integer === true || b.integer === true ? { integer: true as const } : {}),
        minimum: pick(a.minimum, b.minimum, Math.max),
        exclusiveMinimum: pick(a.exclusiveMinimum, b.exclusiveMinimum, Math.max),
        maximum: pick(a.maximum, b.maximum, Math.min),
        exclusiveMaximum: pick(a.exclusiveMaximum, b.exclusiveMaximum, Math.min),
        multipleOf: a.multipleOf ?? b.multipleOf,
      };
      return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)) as Shape;
    }
    return null;
  };

  /** Граница приёма узла без его собственной непрозрачности. */
  const bare = (shape: Shape): Shape =>
    shape.kind === 'opaque' && shape.exact === true ? shape.upper : shape;

  const pipe = (def: Def, path: string): Shape => {
    if (defOf(def.in, path).type === 'transform') {
      return opaqueShape('preprocess', { kind: 'unknown' });
    }
    const input = visit(def.in, path);
    if (typeof def.transform === 'function') {
      return opaqueShape('кодек (stringbool, codec): вход преобразуется перед выходной схемой', input);
    }
    if (defOf(def.out, path).type === 'transform') {
      return opaqueShape('transform', input);
    }
    const output = visit(def.out, path);
    if (canonicalShape(output).kind === 'unknown') {
      // Выходная схема ничего не проверяет: приём — как у входа.
      return input;
    }
    if (!preserves(def.in)) {
      // Выход видит преобразованный вход. Нормализация встроенная и выход описан целиком — поведение известно.
      const known = determined(canonicalShape(input)) && determined(canonicalShape(output));
      const reason = 'pipe: выходная схема видит преобразованный вход';
      return known
        ? {
            kind: 'opaque',
            reason,
            upper: bare(canonicalShape(input)),
            semantics: `pipe ${shapeKey(canonicalShape(input))} → ${shapeKey(canonicalShape(output))}`,
          }
        : opaqueShape(reason, input);
    }
    return piped(input, output) ?? opaqueShape('pipe', input);
  };

  const coerced = (shape: Shape, type: string): Shape => {
    const exact = canonicalShape(shape).kind === 'opaque' ? undefined : shape;
    // Приведение встроенное: тип и проверки после него описаны целиком — два одинаковых узла ведут себя одинаково.
    const semantics =
      exact === undefined ? {} : { semantics: `coerce ${type} ${shapeKey(canonicalShape(exact))}` };
    if (type === 'date') {
      return {
        ...opaqueShape(
          'coerce',
          { kind: 'unknown' },
          exact === undefined ? undefined : { kind: 'string', formats: ['toISOString'] },
        ),
        ...semantics,
      } as Shape;
    }
    return { ...opaqueShape('coerce', { kind: 'unknown' }, exact), ...semantics } as Shape;
  };

  /**
   * `z.json()` — ленивое объединение «строка | число | булево | null |
   * массив себя | словарь себя». Рекурсия здесь — любое значение JSON, а не
   * отказ: на проводе JSON это «что угодно, что пришло» (`undefined` поле не
   * принимает — обязательность снимается поведением).
   */
  const jsonValue = (node: unknown, target: unknown): boolean => {
    const def = (target as { _zod?: { def?: Def } } | null)?._zod?.def;
    if (def?.type !== 'union' || !Array.isArray(def.options) || def.options.length !== 6) {
      return false;
    }
    const kinds = (def.options as unknown[]).map((option) => {
      const inner = (option as { _zod: { def: Def } })._zod.def;
      if (inner.type === 'array') {
        return inner.element === node ? 'array' : 'другое';
      }
      if (inner.type === 'record') {
        return inner.valueType === node ? 'record' : 'другое';
      }
      return inner.type;
    });
    return ['array', 'boolean', 'null', 'number', 'record', 'string'].every((kind) => kinds.includes(kind));
  };

  const kindShape = (node: unknown, def: Def, path: string): Shape => {
    switch (def.type) {
      case 'string':
        return stringShape(node, def);
      case 'number':
      case 'int':
        return numberShape(def);
      case 'boolean':
        return plainChecks({ kind: 'boolean' }, def);
      case 'bigint':
        return plainChecks({ kind: 'bigint' }, def);
      case 'date':
        return plainChecks({ kind: 'date' }, def);
      case 'null':
        return plainChecks({ kind: 'null' }, def);
      case 'undefined':
      case 'void':
        return plainChecks({ kind: 'undefined' }, def);
      case 'any':
      case 'unknown':
        return plainChecks({ kind: 'unknown' }, def);
      case 'never':
        return { kind: 'never' };
      case 'literal':
        return plainChecks(
          {
            kind: 'union',
            options: valuesOf(node, def.values as unknown[]).map((value) => literal(value, path)),
          },
          def,
        );
      case 'enum':
        return plainChecks(
          {
            kind: 'union',
            options: valuesOf(node, Object.values(def.entries as Record<string, unknown>)).map((value) =>
              literal(value, path),
            ),
          },
          def,
        );
      case 'template_literal':
        return plainChecks(
          { kind: 'template', pattern: String((node as { _zod: { pattern: RegExp } })._zod.pattern.source) },
          def,
        );
      case 'object':
        return plainChecks(objectShape(node, def, path), def);
      case 'record':
        return plainChecks(recordShape(node, def, path), def);
      case 'array':
        return arrayShape(def, path);
      case 'tuple': {
        const items = (def.items as unknown[]).map((item, index) => visit(item, `${path}[${index}]`));
        const minItems = tupleRequired(node, def, items.length);
        return plainChecks(
          {
            kind: 'tuple',
            items,
            ...(def.rest === undefined || def.rest === null ? {} : { rest: visit(def.rest, `${path}[...]`) }),
            ...(minItems === undefined ? {} : { minItems }),
          },
          def,
        );
      }
      case 'union': {
        // Размеченное объединение, которое zod не может построить (метка через lazy, pipe…), бросает на ЛЮБОМ разборе.
        if (typeof def.discriminator === 'string') {
          const probe = validateStandard(node, {});
          if (probe.kind === 'threw') {
            return fail(
              path,
              `размеченное объединение бросает на каждом разборе: ${describeThrown(probe.error)}`,
            );
          }
        }
        const options = (def.options as unknown[]).map((option, index) => visit(option, `${path}|${index}`));
        const union: Shape = { kind: 'union', options };
        // xor отвергает значение, подошедшее под два варианта: равен объединению, только если варианты не пересекаются.
        const exclusive =
          def.inclusive === false && !optionsDisjoint(options.map((option) => canonicalShape(option)))
            ? opaqueShape('xor: варианты пересекаются', union)
            : union;
        return plainChecks(exclusive, def);
      }
      case 'intersection':
        return plainChecks(intersection(def, path), def);
      case 'optional':
        return plainChecks(
          { kind: 'union', options: [visit(def.innerType, path), { kind: 'undefined' }] },
          def,
        );
      case 'default':
      case 'prefault': {
        // Приём — как у optional; выход — подставленное значение: зеркалу важно, какое.
        const accepted: Shape = {
          kind: 'union',
          options: [visit(def.innerType, path), { kind: 'undefined' }],
        };
        const value = defaultOf(def);
        return plainChecks(
          exactShape(
            value === undefined ? `${def.type}: функция` : `${def.type} ${value}`,
            accepted,
            value === undefined ? undefined : `${def.type} ${value}`,
          ),
          def,
        );
      }
      case 'nullable':
        return plainChecks({ kind: 'union', options: [visit(def.innerType, path), { kind: 'null' }] }, def);
      case 'nonoptional':
        return plainChecks(withoutUndefined(visit(def.innerType, path)).shape, def);
      case 'readonly':
        return plainChecks(visit(def.innerType, path), def);
      case 'pipe':
        return plainChecks(pipe(def, path), def);
      case 'catch':
        return plainChecks(
          opaqueShape(
            'catch: значение вне схемы молча заменяется запасным',
            { kind: 'unknown' },
            visit(def.innerType, path),
          ),
          def,
        );
      case 'transform':
        return opaqueShape('transform', { kind: 'unknown' });
      case 'lazy': {
        if (typeof def.getter !== 'function') {
          return fail(path, 'lazy без функции-геттера');
        }
        const target = (def.getter as () => unknown)();
        return jsonValue(node, target) ? { kind: 'unknown' } : visit(target, path);
      }
      default:
        return fail(path, `вид схемы «${def.type}» не имеет формы на проводе`);
    }
  };

  const visit = (node: unknown, path: string): Shape => {
    const def = defOf(node, path);
    if (active.has(node)) {
      return fail(path, 'рекурсивная схема: снимок рекурсии не поддерживается');
    }
    if (depth >= CONTRACT_FORMAT.MAX_SHAPE_DEPTH) {
      return fail(
        path,
        `схема глубже ${CONTRACT_FORMAT.MAX_SHAPE_DEPTH} уровней (рекурсия через lazy, который каждый раз строит новую схему?)`,
      );
    }
    active.add(node);
    depth += 1;
    try {
      const shape = kindShape(node, def, path);
      return def.coerce === true ? coerced(shape, def.type) : shape;
    } finally {
      depth -= 1;
      active.delete(node);
    }
  };

  return canonicalShape(visit(schema, ''));
}
