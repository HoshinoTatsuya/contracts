import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { ContractDefinitionError } from '../errors/contract-definition.error';
import { ContractPayloadError } from '../errors/contract-payload.error';
import { ContractVersionError } from '../errors/contract-version.error';
import { canonicalShape } from '../shape/canonical-shape';
import type { ContractDefinition } from '../types/contract-definition.type';
import type { ContractRole } from '../types/contract-role.type';
import type { ContractSnapshot } from '../types/contract-snapshot.type';
import type { ParsedVersion } from '../types/parsed-version.type';
import type { PayloadIssue } from '../types/payload-issue.type';
import type { ReadResult } from '../types/read-result.type';
import type { Shape } from '../types/shape.type';
import type { WireValue } from '../types/wire-value.type';
import type { ZodLike } from '../types/zod-like.type';
import { compareVersions } from '../version/compare-versions';
import { parseVersion } from '../version/parse-version';
import { wireFromValues } from '../wire/wire-from-values';
import { shapeFromZod } from '../zod/shape-from-zod';
import { describeThrown } from './describe-thrown';
import { fieldsOutsideShape } from './fields-outside-shape';
import { findUnknownFields } from './find-unknown-fields';
import { isPlainObject } from './is-plain-object';
import { mergeOutsideFields } from './merge-outside-fields';
import { notifyObserver } from './notify-observer';
import { survivesJson } from './survives-json';
import { validateStandard } from './validate-standard';

/**
 * Контракт на рантайме: запись с версией в payload, терпимое чтение с отказом
 * на чужом мажоре и снимок формы для сверки со второй стороной.
 *
 * Форма и значения на проводе снимаются при объявлении: схема, которую нельзя
 * снять однозначно, — отказ сразу, а не в гейте через неделю.
 */
export class Contract<Output, Input, Wire> {
  public readonly name: string;
  public readonly version: string;
  public readonly versionField: string | null;
  public readonly wire: Wire;
  public readonly shape: Shape;
  public readonly wireValues: Readonly<Record<string, WireValue>>;
  public readonly examples: readonly unknown[];
  private readonly parsed: ParsedVersion;
  private readonly legacy: string | undefined;
  private readonly schema: ZodLike;
  private readonly definition: ContractDefinition<ZodLike, Wire>;

  public constructor(definition: ContractDefinition<ZodLike, Wire>) {
    const name = definition.name;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ContractDefinitionError('контракт', '', 'имя контракта пустое');
    }
    const parsed = parseVersion(definition.version);
    if (parsed === null) {
      throw new ContractDefinitionError(
        name,
        '',
        `версия не разобрана: ${JSON.stringify(definition.version)} (ожидалось MAJOR.MINOR[.PATCH])`,
      );
    }
    if (definition.legacyVersion !== undefined) {
      const legacy = parseVersion(definition.legacyVersion);
      if (legacy === null || legacy.major !== parsed.major) {
        throw new ContractDefinitionError(
          name,
          '',
          `legacyVersion ${JSON.stringify(definition.legacyVersion)} — не версия того же мажора, что ${definition.version}`,
        );
      }
    }
    this.definition = definition;
    this.name = name;
    this.version = definition.version;
    this.parsed = parsed;
    this.legacy = definition.legacyVersion;
    this.schema = definition.schema;
    this.versionField =
      definition.versionField === undefined ? CONTRACT_FORMAT.VERSION_FIELD : definition.versionField;
    this.shape = canonicalShape(shapeFromZod(definition.schema, name));
    if (this.versionField !== null) {
      // `refine` объекта и подобное — непрозрачный узел; поле версии кладётся в его объект.
      const bare = (shape: Shape): Shape => (shape.kind === 'opaque' ? shape.upper : shape);
      const root = bare(this.shape);
      const objects = (root.kind === 'union' ? root.options : [root]).map(bare);
      if (objects.some((shape) => shape.kind !== 'object')) {
        throw new ContractDefinitionError(name, '', 'поле версии едет в payload, а корень схемы — не объект');
      }
      if (
        objects.some(
          (shape) =>
            shape.kind === 'object' &&
            this.versionField !== null &&
            Object.hasOwn(shape.fields, this.versionField),
        )
      ) {
        throw new ContractDefinitionError(name, this.versionField, 'схема сама объявляет поле версии');
      }
    }
    this.wire = definition.wire as Wire;
    this.wireValues = wireFromValues(definition.wire, name);
    const examples = definition.examples ?? [];
    examples.forEach((example, index) => {
      // Образец обязан пережить JSON без потерь И быть тем, что write() выпустил бы на провод.
      if (!survivesJson(example)) {
        throw new ContractDefinitionError(
          name,
          `examples[${index}]`,
          'образец не переживает JSON без потерь',
        );
      }
      const issues = this.wireOf(example).issues;
      if (issues.length > 0) {
        throw new ContractDefinitionError(
          name,
          `examples[${index}]`,
          `образец не проходит схему: ${issues.map((issue) => `${issue.path || '(корень)'} — ${issue.message}`).join('; ')}`,
        );
      }
    });
    this.examples = examples;
  }

  /**
   * Payload для провода: проверенный схемой ВХОД (не выход `transform`, без
   * подставленных `default`) в том виде, в каком он уйдёт по JSON (копия
   * после `JSON.stringify`/`JSON.parse`: экземпляр класса — его собственные
   * поля, `toJSON` — его результат), плюс поле версии — ровно то, что
   * описывает снимок. Копия обязана пройти ту же схему. Писатель не вправе
   * класть поле, которого форма контракта не объявляет (кроме
   * `unknownFields: 'keep'`, что снимок помечает `extraFields: 'kept'`): именно
   * так копии и расходятся — кладут то, чего никто не объявил. Не удалось
   * доказать, что лишнего нет, — тоже отказ.
   */
  public write(data: Input): Input & Record<string, unknown> {
    const { wire, issues, cause } = this.wireOf(data);
    if (issues.length > 0) {
      throw new ContractPayloadError(this.name, issues, cause === undefined ? {} : { cause: cause.error });
    }
    if (this.versionField === null) {
      return wire as Input & Record<string, unknown>;
    }
    return { ...(wire as Record<string, unknown>), [this.versionField]: this.version } as Input &
      Record<string, unknown>;
  }

  /**
   * Терпимое чтение: неизвестные поля не роняют разбор (выбрасываются или
   * сохраняются по `unknownFields`, о них сообщает наблюдатель), отсутствие
   * обязательного и неверный тип — `ContractPayloadError` с путями, чужой
   * мажор — `ContractVersionError`.
   */
  public read(payload: unknown): ReadResult<Output> {
    let version = this.version;
    let body: unknown = payload;
    if (this.versionField !== null) {
      if (!isPlainObject(payload)) {
        throw new ContractPayloadError(this.name, [
          { path: '', message: `ожидался объект, пришло ${payload === null ? 'null' : typeof payload}` },
        ]);
      }
      const { [this.versionField]: received, ...rest } = payload;
      body = rest;
      if (received === undefined) {
        if (this.legacy === undefined) {
          throw new ContractVersionError(this.name, 'missing', undefined, this.version);
        }
        version = this.legacy;
        notifyObserver(this.definition.observer?.legacyPayload, {
          contract: this.name,
          assumedVersion: this.legacy,
        });
      } else {
        const parsed = parseVersion(received);
        if (parsed === null) {
          throw new ContractVersionError(this.name, 'malformed', received, this.version);
        }
        if (parsed.major !== this.parsed.major) {
          throw new ContractVersionError(this.name, 'foreign-major', received, this.version);
        }
        version = received as string;
        if (compareVersions(parsed, this.parsed) > 0) {
          notifyObserver(this.definition.observer?.newerVersion, {
            contract: this.name,
            version,
            readerVersion: this.version,
          });
        }
      }
    }
    const parsed = this.validate(body);
    if (parsed.issues.length > 0) {
      throw new ContractPayloadError(
        this.name,
        parsed.issues,
        parsed.cause === undefined ? {} : { cause: parsed.cause.error },
      );
    }
    const value = parsed.value;
    // Неизвестное — то, чего не объявляет форма; где форма о полях не говорит, — сверка с выходом разбора.
    const shaped = fieldsOutsideShape(body, this.shape, { collapse: true });
    const found =
      shaped.undetermined.length === 0
        ? shaped.outside
        : [...new Set([...shaped.outside, ...findUnknownFields(body, value, { collapse: true })])];
    const unknownFields = found.slice(0, CONTRACT_FORMAT.MAX_UNKNOWN_PATHS);
    const omittedUnknownFields = found.length - unknownFields.length;
    if (unknownFields.length > 0) {
      notifyObserver(this.definition.observer?.unknownFields, {
        contract: this.name,
        version,
        paths: unknownFields,
        omitted: omittedUnknownFields,
      });
    }
    const data = (
      this.definition.unknownFields === 'keep'
        ? mergeOutsideFields(value, body, this.shape, this.name)
        : value
    ) as Output;
    return { data, version, unknownFields, omittedUnknownFields };
  }

  /** Запись контракта для снимка стороны с данной ролью. */
  public snapshot(role: ContractRole): ContractSnapshot {
    return {
      role,
      version: this.version,
      versionField: this.versionField,
      legacyVersion: this.legacy ?? null,
      extraFields: this.definition.unknownFields === 'keep' ? 'kept' : 'refused',
      shape: this.shape,
      wire: this.wireValues,
      examples: this.examples,
    };
  }

  /**
   * Что уйдёт на провод: проверенный вход → JSON-копия → та же схема → поля
   * вне формы. Каждый отказ — отклонение с путём; исключение схемы — в `cause`.
   */
  private wireOf(data: unknown): {
    readonly wire: unknown;
    readonly issues: readonly PayloadIssue[];
    readonly cause?: { readonly error: unknown };
  } {
    const checked = this.validate(data);
    if (checked.issues.length > 0) {
      return {
        wire: undefined,
        issues: checked.issues,
        ...(checked.cause === undefined ? {} : { cause: checked.cause }),
      };
    }
    let wire: unknown;
    try {
      const text = JSON.stringify(data);
      wire = text === undefined ? undefined : (JSON.parse(text) as unknown);
    } catch (error) {
      return {
        wire: undefined,
        issues: [{ path: '', message: `payload не переносится JSON: ${describeThrown(error)}` }],
        cause: { error },
      };
    }
    const onWire = this.validate(wire);
    if (onWire.issues.length > 0) {
      return {
        wire: undefined,
        issues: onWire.issues.map((issue) => ({
          path: issue.path,
          message: `после JSON (то, что уйдёт на провод) схема отвергает: ${issue.message}`,
        })),
        ...(onWire.cause === undefined ? {} : { cause: onWire.cause }),
      };
    }
    if (this.definition.unknownFields === 'keep') {
      return { wire, issues: [] };
    }
    const outsideMessage = 'поле вне контракта: писатель не вправе его класть';
    const { outside, undetermined } = fieldsOutsideShape(wire, this.shape);
    if (outside.length > 0) {
      return { wire: undefined, issues: outside.map((path) => ({ path, message: outsideMessage })) };
    }
    if (undetermined.length === 0) {
      return { wire, issues: [] };
    }
    // Форма о полях не говорит (preprocess, coerce, transform без формы входа) — сверка с выходом разбора.
    const unaligned: string[] = [];
    const lost = findUnknownFields(wire, onWire.value, { unaligned: (path) => unaligned.push(path) });
    const issues: PayloadIssue[] = [
      ...lost.map((path) => ({ path, message: outsideMessage })),
      ...unaligned.map((path) => ({
        path,
        message:
          "не доказано, что здесь нет полей вне контракта: форма (preprocess, coerce, transform) о полях не говорит, а выход разбора со входом не сопоставляется; поля вне формы законны — unknownFields: 'keep'",
      })),
    ];
    return issues.length > 0 ? { wire: undefined, issues } : { wire, issues: [] };
  }

  /**
   * Синхронный разбор схемой. Исключение схемы на этом значении — отклонение
   * (`ContractPayloadError` с исключением в `cause`), асинхронная схема —
   * `ContractDefinitionError`; отклонённый Promise разбора никогда не
   * остаётся без обработчика (иначе процесс падал, хотя ошибку поймали).
   */
  private validate(value: unknown): {
    readonly value: unknown;
    readonly issues: readonly PayloadIssue[];
    readonly cause?: { readonly error: unknown };
  } {
    const outcome = validateStandard(this.schema, value);
    switch (outcome.kind) {
      case 'async':
        throw new ContractDefinitionError(
          this.name,
          '',
          'асинхронная схема (async refine/transform): разбор контракта синхронный',
        );
      case 'threw':
        return {
          value: undefined,
          issues: [{ path: '', message: `схема бросила исключение: ${describeThrown(outcome.error)}` }],
          cause: { error: outcome.error },
        };
      case 'issues':
        return { value: undefined, issues: outcome.issues };
      case 'value':
        return { value: outcome.value, issues: [] };
    }
  }
}
