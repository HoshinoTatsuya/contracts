import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { FINDING_CODE } from '../constants/finding-code.constant';
import { ShapeComparisonError } from '../errors/shape-comparison.error';
import { canonicalShape } from '../shape/canonical-shape';
import { describeShape } from '../shape/describe-shape';
import { determined } from '../shape/determined';
import { formatRule } from '../shape/format-rule';
import { isMultiple } from '../shape/is-multiple';
import { ownField } from '../shape/own-field';
import { regexOf } from '../shape/regex-of';
import { shapeKey } from '../shape/shape-key';
import { stableJson } from '../shape/stable-json';
import { tupleMinimum } from '../shape/tuple-minimum';
import { withoutUndefined } from '../shape/without-undefined';
import type { CompareOutcome as Outcome } from '../types/compare-outcome.type';
import type { ExtraFieldsPolicy } from '../types/extra-fields-policy.type';
import type { Finding } from '../types/finding.type';
import type { FindingCode } from '../types/finding-code.type';
import type { Shape } from '../types/shape.type';
import type { ShapeOf } from '../types/shape-of.type';

/**
 * Совместимость по НАПРАВЛЕНИЮ: всё, что вправе послать писатель, читатель
 * обязан принять и понять так же. Провод — JSON.
 *
 * Три исхода, а не два:
 *
 * - нарушение — то, что читатель отвергнет или поймёт неверно: поле, которое
 *   он требует, а писатель не кладёт или вправе опустить; поле, которое
 *   строгий читатель отвергнет; несовместимый вид; строка на проводе, которой
 *   читатель не знает; ограничение читателя строже писателя; значение, которое
 *   JSON не переносит (`Date`, `bigint`, `undefined` в массиве);
 * - «не доказано» — читатель с семантикой вне формы (`opaque`: `coerce`,
 *   `transform`, `refine`, `catch`…), если писатель не укладывается в то, что
 *   читатель принимает наверняка; писатель, пропускающий поля вне формы
 *   (`extraFields`), против читателя, который их проверит;
 * - совместимо — доказано.
 *
 * Поле, которое писатель кладёт, а читатель не знает и молча выбрасывает, и
 * необязательное поле читателя, которого писатель не кладёт, — в режиме
 * `compatible` замечания (так и выглядит раздельная выкатка), в режиме
 * `aligned` — нарушения: стороны на одной версии обязаны знать одни и те же
 * поля, в том числе объявленно открытый писатель (`looseObject`, `catchall`)
 * против читателя, выбрасывающего лишнее.
 *
 * `sameSource` — сверка двух версий ОДНОЙ стороны (`checkEvolution`):
 * одинаковый непрозрачный узел на одном пути — замечание, а не «не доказано»
 * (функцию снимок не видит, но и форма вокруг неё не менялась).
 */
export function compareShapes(
  writerShape: Shape,
  readerShape: Shape,
  options: {
    readonly contract: string;
    readonly mode: 'compatible' | 'aligned';
    readonly writerExtraFields?: ExtraFieldsPolicy;
    readonly sameSource?: boolean;
  },
): Outcome {
  const { contract, mode } = options;
  const extraFields = options.writerExtraFields ?? 'refused';
  const finding = (code: FindingCode, path: string, message: string): Finding => ({
    contract,
    code,
    path,
    message,
  });
  const ok = (): Outcome => ({ violations: [], unproven: [], notes: [] });
  const fail = (code: FindingCode, path: string, message: string): Outcome => ({
    violations: [finding(code, path, message)],
    unproven: [],
    notes: [],
  });
  const unproven = (path: string, message: string): Outcome => ({
    violations: [],
    unproven: [finding(FINDING_CODE.notProven, path, message)],
    notes: [],
  });
  const note = (code: FindingCode, path: string, message: string): Outcome => ({
    violations: [],
    unproven: [],
    notes: [finding(code, path, message)],
  });
  const merge = (outcomes: readonly Outcome[]): Outcome => ({
    violations: outcomes.flatMap((outcome) => outcome.violations),
    unproven: outcomes.flatMap((outcome) => outcome.unproven),
    notes: outcomes.flatMap((outcome) => outcome.notes),
  });
  /** Нарушение в `aligned`, замечание в `compatible`. */
  const strictInAligned = (code: FindingCode, path: string, message: string): Outcome =>
    mode === 'aligned' ? fail(code, path, message) : note(code, path, message);
  const clean = (outcome: Outcome): boolean =>
    outcome.violations.length === 0 && outcome.unproven.length === 0;
  const tolerable = (outcome: Outcome): boolean => outcome.violations.length === 0;
  const join = (path: string, name: string): string => (path === '' ? name : `${path}.${name}`);
  const where = (path: string): string => (path === '' ? 'корень' : `«${path}»`);
  const typeChanged = (writer: Shape, reader: Shape, path: string): Outcome =>
    fail(
      FINDING_CODE.typeChanged,
      path,
      `${where(path)}: писатель шлёт ${describeShape(writer)}, читатель ждёт ${describeShape(reader)}`,
    );
  const narrowed = (path: string, detail: string): Outcome =>
    fail(FINDING_CODE.constraintNarrowed, path, `${where(path)}: читатель строже писателя — ${detail}`);
  const extraPolicy =
    extraFields === 'kept'
      ? "писатель пересылает поля вне формы (unknownFields: 'keep')"
      : 'писатель — тип TypeScript: поля вне формы ничто не отвергает';

  /** Литерал шаблона из снимка — с его флагами; шаблон, который не разобрать, ничего не принимает. */
  const literalAccepts = (literal: string, value: string): boolean => regexOf(literal)?.test(value) ?? false;
  const templateAccepts = (pattern: string, value: string): boolean => {
    try {
      return new RegExp(pattern).test(value);
    } catch {
      return false;
    }
  };

  /** Длина строки так, как её считает читатель: кодовыми точками (zod 4.6+) или единицами UTF-16. */
  const lengthFor = (reader: ShapeOf<'string'>, value: string): number =>
    reader.codePoints === true ? [...value].length : value.length;
  const stringAccepts = (reader: ShapeOf<'string'>, value: string): boolean =>
    lengthFor(reader, value) >= (reader.minLength ?? 0) &&
    lengthFor(reader, value) <= (reader.maxLength ?? Number.POSITIVE_INFINITY) &&
    (reader.patterns ?? []).every((pattern) => literalAccepts(pattern, value));

  const lowerBound = (shape: ShapeOf<'number'>): readonly [number, boolean] => {
    const inclusive = shape.minimum ?? Number.NEGATIVE_INFINITY;
    const exclusive = shape.exclusiveMinimum ?? Number.NEGATIVE_INFINITY;
    return exclusive >= inclusive ? [exclusive, exclusive !== Number.NEGATIVE_INFINITY] : [inclusive, false];
  };
  const upperBound = (shape: ShapeOf<'number'>): readonly [number, boolean] => {
    const inclusive = shape.maximum ?? Number.POSITIVE_INFINITY;
    const exclusive = shape.exclusiveMaximum ?? Number.POSITIVE_INFINITY;
    return exclusive <= inclusive ? [exclusive, exclusive !== Number.POSITIVE_INFINITY] : [inclusive, false];
  };

  const numbers = (writer: ShapeOf<'number'>, reader: ShapeOf<'number'>, path: string): Outcome => {
    const problems: string[] = [];
    if (reader.integer === true && writer.integer !== true) {
      problems.push('только целые, писатель вправе слать дробные');
    }
    const [writerLow, writerLowExclusive] = lowerBound(writer);
    const [readerLow, readerLowExclusive] = lowerBound(reader);
    if (readerLow > writerLow || (readerLow === writerLow && readerLowExclusive && !writerLowExclusive)) {
      problems.push(
        `нижняя граница ${readerLowExclusive ? '>' : '≥'} ${readerLow}, у писателя ${Number.isFinite(writerLow) ? writerLow : 'без границы'}`,
      );
    }
    const [writerHigh, writerHighExclusive] = upperBound(writer);
    const [readerHigh, readerHighExclusive] = upperBound(reader);
    if (
      readerHigh < writerHigh ||
      (readerHigh === writerHigh && readerHighExclusive && !writerHighExclusive)
    ) {
      problems.push(
        `верхняя граница ${readerHighExclusive ? '<' : '≤'} ${readerHigh}, у писателя ${Number.isFinite(writerHigh) ? writerHigh : 'без границы'}`,
      );
    }
    if (
      reader.multipleOf !== undefined &&
      (writer.multipleOf === undefined || !isMultiple(writer.multipleOf, reader.multipleOf))
    ) {
      problems.push(`кратность ${reader.multipleOf}`);
    }
    return problems.length === 0 ? ok() : narrowed(path, problems.join('; '));
  };

  /** Формат записью `имя{параметры}` → имя и параметры без того, чем он проверяется (выражение, версия zod). */
  const formatParts = (format: string): { readonly name: string; readonly rule: string } => {
    const brace = format.indexOf('{');
    if (brace < 0) {
      return { name: format, rule: '{}' };
    }
    try {
      const {
        pattern: _pattern,
        zod: _zod,
        ...rest
      } = JSON.parse(format.slice(brace)) as Record<string, unknown>;
      return { name: format.slice(0, brace), rule: stableJson(rest) };
    } catch {
      return { name: format, rule: '{}' };
    }
  };

  /** Date писателя по JSON — строка `toISOString()`: 24 знака, с годом вне 0000–9999 — 27 (`+010000-…`). */
  const DATE_ON_WIRE = 'toISOString';
  /** Что из форм строки читателя гарантированно принимает любую строку `toISOString()`. */
  const dateStrings = (reader: ShapeOf<'string'>, path: string): Outcome => {
    const [low, high] = [reader.minLength ?? 0, reader.maxLength ?? Number.POSITIVE_INFINITY];
    if (low > 27 || high < 24) {
      return narrowed(path, `длина ${low}–${high}, а Date писателя едет строкой toISOString из 24–27 знаков`);
    }
    const formats = (reader.formats ?? []).filter((format) => format !== DATE_ON_WIRE);
    if (low <= 24 && high >= 27 && formats.length === 0 && (reader.patterns ?? []).length === 0) {
      return ok();
    }
    return unproven(
      path,
      `${where(path)}: Date писателя едет строкой toISOString (с годом вне 0000–9999 — расширенный год «+010000-…»), а читатель проверяет ${[
        ...formats,
        ...(reader.patterns ?? []),
        ...(low > 24 || high < 27 ? [`длину ${low}–${high}`] : []),
      ].join(', ')} — снимок не доказывает, что примет каждую дату`,
    );
  };

  const strings = (writer: ShapeOf<'string'>, reader: ShapeOf<'string'>, path: string): Outcome => {
    if ((writer.formats ?? []).includes(DATE_ON_WIRE)) {
      return dateStrings(reader, path);
    }
    const problems: string[] = [];
    const doubts: string[] = [];
    // Единицы длины сторон могут различаться: кодовая точка — одна или две единицы UTF-16.
    const writerUnits = writer.codePoints !== true;
    const readerUnits = reader.codePoints !== true;
    const writerMin = writer.minLength ?? 0;
    const writerMax = writer.maxLength ?? Number.POSITIVE_INFINITY;
    const guaranteedMin =
      writerUnits === readerUnits ? writerMin : writerUnits ? Math.ceil(writerMin / 2) : writerMin;
    const guaranteedMax = writerUnits === readerUnits ? writerMax : writerUnits ? writerMax : writerMax * 2;
    const unitNote =
      writerUnits === readerUnits
        ? ''
        : ` (длину писатель считает ${writerUnits ? 'единицами UTF-16' : 'кодовыми точками'}, читатель — ${readerUnits ? 'единицами UTF-16' : 'кодовыми точками'})`;
    if ((reader.minLength ?? 0) > guaranteedMin) {
      problems.push(`длина не меньше ${reader.minLength}, у писателя ${writer.minLength ?? 0}${unitNote}`);
    }
    if ((reader.maxLength ?? Number.POSITIVE_INFINITY) < guaranteedMax) {
      problems.push(
        `длина не больше ${reader.maxLength}, у писателя ${writer.maxLength ?? 'без потолка'}${unitNote}`,
      );
    }
    for (const pattern of reader.patterns ?? []) {
      if (!(writer.patterns ?? []).includes(pattern)) {
        problems.push(`шаблон ${pattern}, которого нет у писателя`);
      }
    }
    for (const format of reader.formats ?? []) {
      if ((writer.formats ?? []).includes(format)) {
        continue;
      }
      // «Строка, которую понимает new Date()» (нижняя граница coerce.date) — её дают datetime и date ISO.
      if (
        format === DATE_ON_WIRE &&
        (writer.formats ?? []).some((own) => ['datetime', 'date'].includes(formatParts(own).name))
      ) {
        continue;
      }
      const wanted = formatParts(format);
      const twin = (writer.formats ?? []).find((own) => {
        const parts = formatParts(own);
        return parts.name === wanted.name && parts.rule === wanted.rule;
      });
      if (twin === undefined) {
        problems.push(`формат ${format}, которого нет у писателя`);
      } else {
        doubts.push(
          `формат ${wanted.name} у сторон проверяется по-разному (${twin} против ${format}): разные версии zod?`,
        );
      }
    }
    return merge([
      problems.length === 0 ? ok() : narrowed(path, problems.join('; ')),
      doubts.length === 0
        ? ok()
        : unproven(path, `${where(path)}: ${doubts.join('; ')} — совместимость не доказана`),
    ]);
  };

  /**
   * Строки на проводе писателя против читателя-объединения — ПО ВАРИАНТАМ:
   * строка принята, если её чисто принимает хоть один вариант; принята лишь
   * вариантом без доказательства — «не доказано». Сверка одной строки с
   * объединением целиком вернула бы сюда же — бесконечная петля.
   */
  const enumAgainstUnion = (values: readonly string[], reader: ShapeOf<'union'>, path: string): Outcome => {
    const missing: string[] = [];
    const doubtful: Outcome[] = [];
    for (const value of values) {
      const tried = reader.options.map((option) => check({ kind: 'enum', values: [value] }, option, path));
      if (tried.some(clean)) {
        continue;
      }
      const maybe = tried.find(tolerable);
      if (maybe === undefined) {
        missing.push(value);
      } else {
        doubtful.push(maybe);
      }
    }
    return merge([
      missing.length === 0
        ? ok()
        : fail(
            FINDING_CODE.wireValueUnknown,
            path,
            `${where(path)}: читатель не знает строк на проводе ${missing.map((value) => `«${value}»`).join(', ')}`,
          ),
      ...doubtful,
    ]);
  };

  const renameHint = (
    name: string,
    shape: Shape,
    candidates: Readonly<Record<string, { shape: Shape }>>,
    skip: (other: string) => boolean,
  ): string => {
    const target = stableJson(shape);
    const similar = Object.keys(candidates).filter(
      (other) => !skip(other) && stableJson((candidates[other] as { shape: Shape }).shape) === target,
    );
    return similar.length === 1 ? ` (похоже на переименование «${name}» ↔ «${similar[0]}»)` : '';
  };

  /** Поля вне формы, которые писатель пропускает по политике записи, против политики читателя. */
  const undeclaredExtras = (reader: ShapeOf<'object'>, path: string): Outcome => {
    const restPath = `${path}{*}`;
    if (reader.unknownKeys === 'reject') {
      return fail(
        FINDING_CODE.openToStrict,
        restPath,
        `${where(path)}: ${extraPolicy}, строгий читатель отвергнет сообщение с ними`,
      );
    }
    if (reader.unknownKeys === 'keep' && (reader.rest ?? { kind: 'unknown' }).kind !== 'unknown') {
      return unproven(
        restPath,
        `${where(path)}: ${extraPolicy}, а читатель проверяет лишние поля как ${describeShape(reader.rest as Shape)}`,
      );
    }
    return ok();
  };

  const objects = (writer: ShapeOf<'object'>, reader: ShapeOf<'object'>, path: string): Outcome => {
    const outcomes: Outcome[] = [];
    for (const [name, field] of Object.entries(writer.fields)) {
      const fieldPath = join(path, name);
      const own = ownField(reader.fields, name);
      if (own === undefined) {
        const hint = renameHint(name, field.shape, reader.fields, (other) =>
          Object.hasOwn(writer.fields, other),
        );
        if (reader.unknownKeys === 'reject') {
          outcomes.push(
            fail(
              FINDING_CODE.fieldRejected,
              fieldPath,
              `${where(fieldPath)}: писатель кладёт поле, которого строгий читатель не знает, — сообщение будет отвергнуто${hint}`,
            ),
          );
        } else if (reader.unknownKeys === 'keep') {
          outcomes.push(check(field.shape, reader.rest ?? { kind: 'unknown' }, fieldPath));
        } else {
          outcomes.push(
            strictInAligned(
              FINDING_CODE.fieldUnread,
              fieldPath,
              `${where(fieldPath)}: писатель кладёт поле, которого читатель не знает, — оно будет молча выброшено${hint}`,
            ),
          );
        }
        continue;
      }
      if (!own.optional && (field.optional || field.undefinedAccepted === true)) {
        outcomes.push(
          fail(
            FINDING_CODE.fieldMayBeMissing,
            fieldPath,
            field.optional
              ? `${where(fieldPath)}: обязательно для читателя, а писатель вправе его опустить`
              : `${where(fieldPath)}: обязательно для читателя, а писатель вправе положить undefined — по JSON поле пропадёт`,
          ),
        );
      }
      outcomes.push(check(field.shape, own.shape, fieldPath));
    }
    for (const [name, field] of Object.entries(reader.fields)) {
      if (Object.hasOwn(writer.fields, name)) {
        continue;
      }
      const fieldPath = join(path, name);
      const hint = renameHint(name, field.shape, writer.fields, (other) =>
        Object.hasOwn(reader.fields, other),
      );
      if (!field.optional) {
        outcomes.push(
          fail(
            FINDING_CODE.fieldRequiredMissing,
            fieldPath,
            `${where(fieldPath)}: читатель требует поле, а писатель его не кладёт${hint}`,
          ),
        );
        continue;
      }
      // Объявленно открытый писатель вправе положить и это имя — со значением своего catchall;
      // писатель, пропускающий поля вне формы, — с любым значением.
      // Поле читателя «что угодно» примет любое значение — пришедшее из спреда или catchall тоже.
      const sent =
        field.shape.kind === 'unknown'
          ? ok()
          : writer.unknownKeys === 'keep'
            ? check(propertyValue(writer.rest), field.shape, fieldPath)
            : writer.unknownKeys === 'strip' && extraFields !== 'refused'
              ? unproven(
                  fieldPath,
                  `${where(fieldPath)}: ${extraPolicy} — поле с этим именем может прийти с любым значением, читатель ждёт ${describeShape(field.shape)}`,
                )
              : ok();
      outcomes.push(
        tolerable(sent)
          ? merge([
              sent,
              strictInAligned(
                FINDING_CODE.fieldUnsent,
                fieldPath,
                `${where(fieldPath)}: читатель читает необязательное поле, а писатель его не кладёт${hint}`,
              ),
            ])
          : sent,
      );
    }
    if (writer.unknownKeys === 'keep') {
      const restPath = `${path}{*}`;
      if (reader.unknownKeys === 'reject') {
        outcomes.push(
          fail(
            FINDING_CODE.openToStrict,
            restPath,
            `${where(path)}: писатель вправе класть произвольные поля, строгий читатель отвергнет сообщение`,
          ),
        );
      } else if (reader.unknownKeys === 'keep') {
        outcomes.push(check(propertyValue(writer.rest), reader.rest ?? { kind: 'unknown' }, restPath));
      } else {
        outcomes.push(
          strictInAligned(
            FINDING_CODE.fieldUnread,
            restPath,
            `${where(path)}: произвольные поля писателя читатель молча выбрасывает`,
          ),
        );
      }
    } else if (writer.unknownKeys === 'strip' && extraFields !== 'refused') {
      outcomes.push(undeclaredExtras(reader, path));
    }
    return merge(outcomes);
  };

  /**
   * Объект писателя против объединения читателя, в котором есть варианты-объекты.
   *
   * Метки — поля, у которых и у писателя, и у КАЖДОГО варианта-объекта
   * читателя ровно одна строка. Вариант выбирается по ВСЕМ меткам сразу: поле
   * с одной и той же строкой во всех вариантах ничего не отсекает, различает
   * значение поля или сочетание значений. Выбор поэтому не зависит ни от
   * порядка полей, ни от того, какая метка «первая».
   *
   * - подошёл ровно один вариант — сверка с ним (пути — внутри варианта);
   * - не подошёл ни один — `wire-value-unknown` по каждой метке, строки
   *   которой читатель не знает; знает каждую по отдельности, но не сочетание —
   *   `union-option-unmatched`;
   * - метки варианты не различают (подошло несколько) — сверка формы: принят,
   *   если хоть один вариант принимает форму писателя целиком (доказанно —
   *   раньше, чем «не доказано»); иначе `union-option-unmatched` с причиной и
   *   ближайшим вариантом в тексте, а не молча нарушения «ближайшего».
   *
   * Вариант другого вида (словарь), принимающий форму писателя целиком, тоже
   * принимает сообщение.
   */
  const objectUnionReader = (
    writer: ShapeOf<'object'>,
    objects: readonly ShapeOf<'object'>[],
    reader: ShapeOf<'union'>,
    path: string,
  ): Outcome => {
    // Метка — поле с одним значением: строкой (`enum` из одной) или литералом (`200`, `true`).
    // Ключ различает вид, чтобы строка «200» и число 200 не совпали; в тексте — само значение.
    const tagOf = (shape: ShapeOf<'object'>, name: string): string | undefined => {
      const field = ownField(shape.fields, name);
      if (field === undefined) {
        return undefined;
      }
      if (field.shape.kind === 'enum' && field.shape.values.length === 1) {
        return `s${field.shape.values[0]}`;
      }
      return field.shape.kind === 'literal' ? `l${String(field.shape.value)}` : undefined;
    };
    const label = (key: string | undefined): string => String(key).slice(1);
    // Поле писателя с несколькими значениями метки (`'a' | 'b'`, `200 | 400`, `boolean`) — по варианту на значение.
    const singles = (shape: Shape): Shape[] | undefined => {
      const one = (option: Shape): Shape[] =>
        option.kind === 'enum' ? option.values.map((value) => ({ kind: 'enum', values: [value] })) : [option];
      if (shape.kind === 'enum' && shape.values.length > 1) {
        return one(shape);
      }
      if (shape.kind === 'boolean') {
        return [
          { kind: 'literal', value: false },
          { kind: 'literal', value: true },
        ];
      }
      if (
        shape.kind === 'union' &&
        shape.options.every((option) => option.kind === 'enum' || option.kind === 'literal')
      ) {
        return shape.options.flatMap(one);
      }
      return undefined;
    };
    if (objects.length > 1) {
      for (const [name, field] of Object.entries(writer.fields)) {
        const split = singles(field.shape);
        if (split !== undefined && objects.every((option) => tagOf(option, name) !== undefined)) {
          return merge(
            split.map((value) =>
              check(
                { ...writer, fields: { ...writer.fields, [name]: { ...field, shape: value } } },
                reader,
                path,
              ),
            ),
          );
        }
      }
    }
    const tags =
      objects.length > 1
        ? Object.keys(writer.fields).filter(
            (name) =>
              tagOf(writer, name) !== undefined &&
              objects.every((option) => tagOf(option, name) !== undefined),
          )
        : [];
    const matching = objects.filter((option) =>
      tags.every((tag) => tagOf(option, tag) === tagOf(writer, tag)),
    );
    const others = (): Outcome[] =>
      reader.options
        .filter((option) => option.kind !== 'object')
        .map((option) => check(writer, option, path));
    const best = (tried: readonly Outcome[]): Outcome | undefined =>
      tried.find(clean) ?? tried.find(tolerable);
    const [only] = matching;
    if (matching.length === 1 && only !== undefined) {
      const outcome = check(writer, only, path);
      return clean(outcome) ? outcome : (best([...others(), outcome]) ?? outcome);
    }
    const other = best(others());
    if (other !== undefined && clean(other)) {
      return other;
    }
    if (matching.length === 0) {
      if (other !== undefined) {
        return other;
      }
      const unknown = tags.filter(
        (tag) => !objects.some((option) => tagOf(option, tag) === tagOf(writer, tag)),
      );
      if (unknown.length > 0) {
        return merge(
          unknown.map((tag) =>
            fail(
              FINDING_CODE.wireValueUnknown,
              join(path, tag),
              `${where(join(path, tag))}: читатель не знает варианта «${label(tagOf(writer, tag))}»`,
            ),
          ),
        );
      }
      return fail(
        FINDING_CODE.unionOptionUnmatched,
        path,
        `${where(path)}: сочетание меток ${tags.map((tag) => `${tag}=«${label(tagOf(writer, tag))}»`).join(', ')} не совпадает ни с одним вариантом читателя, хотя каждую строку он знает`,
      );
    }
    const tried = matching.map((option) => check(writer, option, path));
    const accepted = best(other === undefined ? tried : [...tried, other]);
    if (accepted !== undefined) {
      return firstMatch(accepted, tried, path);
    }
    const closest = [...tried].sort((a, b) => a.violations.length - b.violations.length)[0] as Outcome;
    return fail(
      FINDING_CODE.unionOptionUnmatched,
      path,
      `${where(path)}: метки ${tags.length === 0 ? '(их нет)' : tags.map((tag) => `«${tag}»`).join(', ')} не различают ${matching.length} вариантов читателя, а форму писателя целиком не принимает ни один; ближе всех вариант с нарушениями: ${closest.violations.map((item) => item.message).join('; ')}`,
    );
  };

  /**
   * zod отдаёт ПЕРВЫЙ подошедший вариант объединения, а порядок вариантов
   * снимок не хранит (каноническая запись их сортирует). Если сообщение
   * принимает и вариант, который выбросит поля писателя, — именно он может
   * оказаться первым: в `aligned` это «не доказано», в `compatible` —
   * замечание `field-unread`.
   */
  const firstMatch = (accepted: Outcome, tried: readonly Outcome[], path: string): Outcome => {
    if (!clean(accepted) || accepted.notes.some((item) => item.code === FINDING_CODE.fieldUnread)) {
      return accepted;
    }
    const strips = tried.find((outcome) =>
      mode === 'aligned'
        ? outcome.unproven.length === 0 &&
          outcome.violations.length > 0 &&
          outcome.violations.every((item) => item.code === FINDING_CODE.fieldUnread)
        : clean(outcome) && outcome.notes.some((item) => item.code === FINDING_CODE.fieldUnread),
    );
    if (strips === undefined) {
      return accepted;
    }
    const lost = (mode === 'aligned' ? strips.violations : strips.notes)
      .filter((item) => item.code === FINDING_CODE.fieldUnread)
      .map((item) => `«${item.path}»`)
      .join(', ');
    const message = `${where(path)}: zod отдаёт первый подошедший вариант, а порядок вариантов снимок не хранит — сообщение примет и вариант, который выбросит ${lost}`;
    return merge([
      accepted,
      mode === 'aligned' ? unproven(path, message) : note(FINDING_CODE.fieldUnread, path, message),
    ]);
  };

  const unionReader = (writer: Shape, reader: ShapeOf<'union'>, path: string): Outcome => {
    if (writer.kind === 'enum') {
      return enumAgainstUnion(writer.values, reader, path);
    }
    if (writer.kind === 'object') {
      const objects = reader.options.filter(
        (option): option is ShapeOf<'object'> => option.kind === 'object',
      );
      if (objects.length > 0) {
        return objectUnionReader(writer, objects, reader, path);
      }
    }
    const tried = reader.options.map((option) => check(writer, option, path));
    const accepted = tried.find(clean) ?? tried.find(tolerable);
    if (accepted !== undefined) {
      return firstMatch(accepted, tried, path);
    }
    const sameKind = reader.options
      .map((option, index) => ({ option, outcome: tried[index] as Outcome }))
      .filter(({ option }) => option.kind === writer.kind)
      .sort((a, b) => a.outcome.violations.length - b.outcome.violations.length);
    const [closest] = sameKind;
    if (closest !== undefined) {
      return closest.outcome;
    }
    return fail(
      FINDING_CODE.unionOptionUnmatched,
      path,
      `${where(path)}: писатель шлёт ${describeShape(writer)}, ни один вариант читателя (${describeShape(reader)}) это не принимает`,
    );
  };

  /**
   * Читатель с семантикой вне формы. Писатель укладывается в принятое
   * наверняка (`lower`) — доказано; выходит за надмножество (`upper`) —
   * нарушение наверняка; иначе — «не доказано».
   */
  const opaqueReader = (writer: Shape, reader: ShapeOf<'opaque'>, path: string): Outcome => {
    if (reader.lower !== undefined) {
      const exact = check(writer, reader.lower, path);
      if (clean(exact)) {
        return exact;
      }
    }
    const bound = check(writer, reader.upper, path);
    if (!tolerable(bound)) {
      return bound;
    }
    return merge([
      bound,
      unproven(
        path,
        `${where(path)}: читатель — ${describeShape(reader)}: что он примет из «${describeShape(writer)}», форма не выражает${
          reader.lower === undefined ? '' : ` (наверняка — ${describeShape(reader.lower)})`
        }; совместимость не доказана`,
      ),
    ]);
  };

  /**
   * Значение свойства словаря или лишнего поля писателя на проводе: свойство со
   * значением `undefined` JSON выбрасывает целиком — оно не приходит, а не
   * приходит `undefined`.
   */
  const propertyValue = (shape: Shape | undefined): Shape =>
    withoutUndefined(shape ?? { kind: 'unknown' }).shape;

  /** Элемент массива или член кортежа писателя: `undefined` по JSON едет как `null`. */
  const element = (writer: Shape, reader: Shape, path: string): Outcome => {
    const { shape: defined, hadUndefined } = withoutUndefined(writer);
    if (!hadUndefined) {
      return check(writer, reader, path);
    }
    const nulls = check({ kind: 'null' }, reader, path);
    return merge([
      check(defined, reader, path),
      tolerable(nulls)
        ? nulls
        : fail(
            FINDING_CODE.jsonLossy,
            path,
            `${where(path)}: писатель вправе положить undefined — по JSON оно едет как null, а читатель null не примет`,
          ),
    ]);
  };

  /** Длины, которые вправе прислать кортеж писателя: обязательные члены — снизу, хвост — без потолка. */
  const tupleLengths = (writer: ShapeOf<'tuple'>): readonly [number, number] => [
    tupleMinimum(writer),
    writer.rest === undefined ? writer.items.length : Number.POSITIVE_INFINITY,
  ];

  // Предохранитель: петля в сверке (или форма глубже любой настоящей) — отказ с путём, а не переполнение стека.
  let depth = 0;
  const check = (writer: Shape, reader: Shape, path: string): Outcome => {
    if (depth >= CONTRACT_FORMAT.MAX_COMPARE_DEPTH) {
      throw new ShapeComparisonError(
        contract,
        path,
        `сверка форм ушла глубже ${CONTRACT_FORMAT.MAX_COMPARE_DEPTH} уровней — петля в сверке или форма глубже любой настоящей; «совместимо» не доказано`,
      );
    }
    depth += 1;
    try {
      return checkAt(writer, reader, path);
    } finally {
      depth -= 1;
    }
  };

  const checkAt = (writer: Shape, reader: Shape, path: string): Outcome => {
    if (writer.kind === 'never') {
      return ok();
    }
    // Поведение описано целиком без функций пользователя и одинаково — одинаково и принимается.
    if (
      writer.kind === 'opaque' &&
      reader.kind === 'opaque' &&
      writer.semantics !== undefined &&
      determined(writer) &&
      shapeKey(writer) === shapeKey(reader)
    ) {
      return ok();
    }
    if (
      options.sameSource === true &&
      writer.kind === 'opaque' &&
      reader.kind === 'opaque' &&
      shapeKey(writer) === shapeKey(reader)
    ) {
      return note(
        FINDING_CODE.notProven,
        path,
        `${where(path)}: ${describeShape(reader)} — в обеих версиях одинаково; изменение самой функции снимок не видит`,
      );
    }
    if (writer.kind === 'opaque') {
      return check(writer.upper, reader, path);
    }
    if (reader.kind === 'unknown') {
      return ok();
    }
    if (reader.kind === 'opaque') {
      // Узел меняет только выход (default, trim): приём ровно как у upper.
      return reader.exact === true ? check(writer, reader.upper, path) : opaqueReader(writer, reader, path);
    }
    if (writer.kind === 'union') {
      return merge(writer.options.map((option) => check(option, reader, path)));
    }
    if (writer.kind === 'bigint' || reader.kind === 'bigint') {
      return fail(
        FINDING_CODE.jsonLossy,
        path,
        `${where(path)}: bigint не переживает JSON (JSON.stringify отказывает)`,
      );
    }
    // Объединение читателя разбирается по вариантам: против варианта z.date() — json-lossy, против строки — toISOString.
    if (writer.kind === 'date' && reader.kind !== 'date' && reader.kind !== 'union') {
      // По JSON дата едет строкой toISOString() — с годом вне 0000–9999 это расширенный год.
      return check({ kind: 'string', formats: [DATE_ON_WIRE] }, reader, path);
    }
    if (reader.kind === 'union') {
      return unionReader(writer, reader, path);
    }
    if (reader.kind === 'date') {
      return fail(
        FINDING_CODE.jsonLossy,
        path,
        `${where(path)}: читатель ждёт Date, а по JSON дата едет строкой — z.date() её отвергнет (нужен z.coerce.date() или z.iso.datetime())`,
      );
    }
    if (writer.kind === 'unknown') {
      return fail(
        FINDING_CODE.typeChanged,
        path,
        `${where(path)}: писатель не описывает тип (что угодно), читатель ждёт ${describeShape(reader)}`,
      );
    }
    switch (writer.kind) {
      case 'enum': {
        if (reader.kind === 'enum') {
          const missing = writer.values.filter((value) => !reader.values.includes(value));
          return missing.length === 0
            ? ok()
            : fail(
                FINDING_CODE.wireValueUnknown,
                path,
                `${where(path)}: читатель не знает строк на проводе ${missing.map((value) => `«${value}»`).join(', ')}`,
              );
        }
        if (reader.kind === 'string') {
          const rejected = writer.values.filter((value) => !stringAccepts(reader, value));
          if (rejected.length > 0) {
            return narrowed(path, `не примет строки ${rejected.map((value) => `«${value}»`).join(', ')}`);
          }
          // Формат, описанный только выражением, проверяется им; формат с функцией (версия zod) — нечем.
          const unchecked: string[] = [];
          const failing = new Set<string>();
          for (const format of reader.formats ?? []) {
            const rule = formatRule(format);
            if (rule === undefined) {
              unchecked.push(format);
              continue;
            }
            for (const value of writer.values) {
              if (!rule.test(value)) {
                failing.add(value);
              }
            }
          }
          if (failing.size > 0) {
            return narrowed(
              path,
              `формат читателя не примет строки ${[...failing].map((value) => `«${value}»`).join(', ')}`,
            );
          }
          return unchecked.length > 0
            ? unproven(
                path,
                `${where(path)}: читатель проверяет формат ${unchecked.join(', ')}, а строки писателя ${writer.values.map((value) => `«${value}»`).join(', ')} снимок по формату проверить не может`,
              )
            : ok();
        }
        if (reader.kind === 'template') {
          const rejected = writer.values.filter((value) => !templateAccepts(reader.pattern, value));
          return rejected.length === 0
            ? ok()
            : narrowed(
                path,
                `шаблон /${reader.pattern}/ не примет ${rejected.map((value) => `«${value}»`).join(', ')}`,
              );
        }
        return typeChanged(writer, reader, path);
      }
      case 'literal': {
        if (reader.kind === 'literal') {
          return reader.value === writer.value
            ? ok()
            : fail(
                FINDING_CODE.literalChanged,
                path,
                `${where(path)}: писатель шлёт ${String(writer.value)}, читатель ждёт ${String(reader.value)}`,
              );
        }
        if (reader.kind === 'boolean' && typeof writer.value === 'boolean') {
          return ok();
        }
        if (reader.kind === 'number' && typeof writer.value === 'number') {
          const value = writer.value;
          return numbers(
            {
              kind: 'number',
              minimum: value,
              maximum: value,
              ...(Number.isInteger(value) ? { integer: true } : {}),
              ...(reader.multipleOf !== undefined && isMultiple(value, reader.multipleOf)
                ? { multipleOf: reader.multipleOf }
                : {}),
            },
            reader,
            path,
          );
        }
        return typeChanged(writer, reader, path);
      }
      case 'string':
        if (reader.kind === 'string') {
          return strings(writer, reader, path);
        }
        if (reader.kind === 'enum') {
          return fail(
            FINDING_CODE.wireValueUnknown,
            path,
            `${where(path)}: писатель вправе слать любую строку, читатель принимает только ${describeShape(reader)}`,
          );
        }
        if (reader.kind === 'template') {
          return narrowed(path, `шаблон /${reader.pattern}/, писатель вправе слать любую строку`);
        }
        return typeChanged(writer, reader, path);
      case 'template':
        if (reader.kind === 'template') {
          return reader.pattern === writer.pattern
            ? ok()
            : narrowed(path, `шаблон /${reader.pattern}/ вместо /${writer.pattern}/`);
        }
        if (reader.kind === 'string') {
          return strings({ kind: 'string', patterns: [`/${writer.pattern}/`] }, reader, path);
        }
        return typeChanged(writer, reader, path);
      case 'number':
        if (reader.kind !== 'number') {
          return typeChanged(writer, reader, path);
        }
        return merge([
          numbers(writer, reader, path),
          // Тип TypeScript не запрещает NaN и бесконечность, а JSON везёт их как null.
          extraFields === 'unchecked'
            ? note(
                FINDING_CODE.jsonLossy,
                path,
                `${where(path)}: писатель — тип TypeScript: number допускает NaN и Infinity, по JSON они едут null, а читатель null не примет`,
              )
            : ok(),
        ]);
      case 'boolean':
        if (reader.kind === 'boolean') {
          return ok();
        }
        if (reader.kind === 'literal' && typeof reader.value === 'boolean') {
          return narrowed(path, `принимает только ${String(reader.value)}`);
        }
        return typeChanged(writer, reader, path);
      case 'date':
      case 'null':
      case 'undefined':
        return reader.kind === writer.kind ? ok() : typeChanged(writer, reader, path);
      case 'object':
        if (reader.kind === 'object') {
          return objects(writer, reader, path);
        }
        if (reader.kind === 'record') {
          const extras =
            writer.unknownKeys === 'keep'
              ? merge([
                  check({ kind: 'string' }, reader.key, `${path}{key}`),
                  check(propertyValue(writer.rest), reader.value, `${path}{*}`),
                ])
              : writer.unknownKeys === 'strip' && extraFields !== 'refused'
                ? unproven(`${path}{*}`, `${where(path)}: ${extraPolicy}, а читатель-словарь проверит каждое`)
                : ok();
          return merge([
            ...Object.entries(writer.fields).map(([name, field]) =>
              merge([
                check({ kind: 'enum', values: [name] }, reader.key, `${join(path, name)}{key}`),
                check(field.shape, reader.value, join(path, name)),
              ]),
            ),
            extras,
          ]);
        }
        return typeChanged(writer, reader, path);
      case 'record':
        if (reader.kind === 'record') {
          return merge([
            check(writer.key, reader.key, `${path}{key}`),
            check(propertyValue(writer.value), reader.value, `${path}{*}`),
          ]);
        }
        if (reader.kind === 'object' && Object.values(reader.fields).every((field) => field.optional)) {
          if (reader.unknownKeys === 'reject') {
            return fail(
              FINDING_CODE.openToStrict,
              `${path}{*}`,
              `${where(path)}: словарь писателя вправе нести любые ключи, строгий читатель отвергнет сообщение`,
            );
          }
          return merge([
            reader.unknownKeys === 'keep'
              ? check(propertyValue(writer.value), reader.rest ?? { kind: 'unknown' }, `${path}{*}`)
              : ok(),
            ...Object.entries(reader.fields).map(([name, field]) =>
              check(propertyValue(writer.value), field.shape, join(path, name)),
            ),
          ]);
        }
        return typeChanged(writer, reader, path);
      case 'array':
        if (reader.kind === 'array') {
          const problems: string[] = [];
          if ((reader.minItems ?? 0) > (writer.minItems ?? 0)) {
            problems.push(`не меньше ${reader.minItems} элементов, у писателя ${writer.minItems ?? 0}`);
          }
          if ((reader.maxItems ?? Number.POSITIVE_INFINITY) < (writer.maxItems ?? Number.POSITIVE_INFINITY)) {
            problems.push(
              `не больше ${reader.maxItems} элементов, у писателя ${writer.maxItems ?? 'без потолка'}`,
            );
          }
          return merge([
            problems.length === 0 ? ok() : narrowed(path, problems.join('; ')),
            element(writer.element, reader.element, `${path}[]`),
          ]);
        }
        return typeChanged(writer, reader, path);
      case 'tuple':
        if (reader.kind === 'array') {
          const [shortest, longest] = tupleLengths(writer);
          const problems: string[] = [];
          if ((reader.minItems ?? 0) > shortest) {
            problems.push(`не меньше ${reader.minItems} элементов, кортеж писателя — от ${shortest}`);
          }
          if ((reader.maxItems ?? Number.POSITIVE_INFINITY) < longest) {
            problems.push(
              `не больше ${reader.maxItems} элементов, кортеж писателя — ${Number.isFinite(longest) ? `до ${longest}` : 'с хвостом без потолка'}`,
            );
          }
          return merge([
            problems.length === 0 ? ok() : narrowed(path, problems.join('; ')),
            ...writer.items.map((item, index) => element(item, reader.element, `${path}[${index}]`)),
            ...(writer.rest === undefined ? [] : [element(writer.rest, reader.element, `${path}[...]`)]),
          ]);
        }
        if (reader.kind === 'tuple') {
          // Длины, которые вправе прислать писатель, против длин, которые примет читатель.
          const [shortest, longest] = tupleLengths(writer);
          const [required, accepted] = tupleLengths(reader);
          const outcomes: Outcome[] = [];
          if (shortest < required) {
            outcomes.push(
              fail(
                FINDING_CODE.tupleLength,
                `${path}[${shortest}]`,
                `${where(path)}: читатель требует не меньше ${required} элементов, писатель вправе прислать ${shortest}`,
              ),
            );
          }
          if (longest > accepted) {
            outcomes.push(
              fail(
                FINDING_CODE.tupleLength,
                Number.isFinite(longest) ? `${path}[${accepted}]` : `${path}[...]`,
                `${where(path)}: писатель вправе прислать ${Number.isFinite(longest) ? longest : 'сколько угодно'} элементов, читатель принимает не больше ${accepted}`,
              ),
            );
          }
          // Каждая позиция, которую писатель вправе занять, — против того, что на ней ждёт читатель.
          writer.items.forEach((item, index) => {
            const own = reader.items[index] ?? reader.rest;
            if (own !== undefined) {
              outcomes.push(element(item, own, `${path}[${index}]`));
            }
          });
          if (writer.rest !== undefined) {
            for (let index = writer.items.length; index < reader.items.length; index += 1) {
              outcomes.push(element(writer.rest, reader.items[index] as Shape, `${path}[${index}]`));
            }
            if (reader.rest !== undefined) {
              outcomes.push(element(writer.rest, reader.rest, `${path}[...]`));
            }
          }
          return merge(outcomes);
        }
        return typeChanged(writer, reader, path);
    }
  };

  return check(canonicalShape(writerShape), canonicalShape(readerShape), '');
}
