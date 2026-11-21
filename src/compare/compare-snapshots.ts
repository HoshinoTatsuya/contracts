import { FINDING_CODE } from '../constants/finding-code.constant';
import { ContractDefinitionError } from '../errors/contract-definition.error';
import type { CompareMode } from '../types/compare-mode.type';
import type { CompareOutcome } from '../types/compare-outcome.type';
import type { ContractSnapshot } from '../types/contract-snapshot.type';
import type { Finding } from '../types/finding.type';
import type { Shape } from '../types/shape.type';
import type { SnapshotDocument } from '../types/snapshot-document.type';
import type { Verdict } from '../types/verdict.type';
import { parseVersion } from '../version/parse-version';
import { sameVersion } from '../version/same-version';
import { checkExamples } from './check-examples';
import { compareShapes } from './compare-shapes';
import { compareWire } from './compare-wire';
import { diffShapes } from './diff-shapes';
import { toVerdict } from './to-verdict';
import { withRootField } from './with-root-field';

/**
 * Сверка снимков ДВУХ сторон контракта (своей и другой, развёрнутой или из
 * её репозитория). Направление каждого контракта берётся из ролей: то, что
 * пишет одна сторона, обязана принять другая.
 *
 * - контракт есть у одной стороны и нет у другой — нарушение (сообщения уходят
 *   в никуда или читаются из ниоткуда); то, что законно, вносится в `known`;
 * - разные мажоры — нарушение: читатель отвергнет каждое сообщение;
 * - поле версии писателя не то, что ищет читатель, — нарушение, если читатель
 *   не принимает payload без версии (`legacyVersion`); принимает — замечание;
 *   поле версии писателя сверяется как часть его формы: строгий читатель,
 *   типизированный `catchall`, корень-словарь и поле того же имени другого
 *   типа — нарушения формы;
 * - `mirror` — формы, значения на проводе и политика (поле версии,
 *   `legacyVersion`, `extraFields`) обязаны совпасть целиком, роли не важны;
 *   иначе — `compareShapes` по каждому направлению (с политикой записи
 *   писателя) и `compareWire`;
 * - образцы писателя проверяются формой читателя;
 * - `only` — выборка контрактов; имя, которого нет ни у одной стороны, и
 *   пустая выборка — отказ `ContractDefinitionError`: «совместимо» на пустой
 *   выборке ничего не доказывает.
 */
export function compareSnapshots(
  mine: SnapshotDocument,
  peer: SnapshotDocument,
  options: {
    readonly mode?: CompareMode;
    readonly labels?: readonly [string, string];
    readonly only?: readonly string[];
  } = {},
): Verdict {
  const mode = options.mode ?? 'compatible';
  const [here, there] = options.labels ?? ['здесь', 'у другой стороны'];
  const violations: Finding[] = [];
  const unproven: Finding[] = [];
  const notes: Finding[] = [];
  const all = [...new Set([...Object.keys(mine.contracts), ...Object.keys(peer.contracts)])];
  if (options.only !== undefined) {
    const only = options.only.map((name) => name.trim()).filter((name) => name !== '');
    if (only.length === 0) {
      throw new ContractDefinitionError('only', '', 'выборка контрактов пуста — сверять нечего');
    }
    const absent = only.filter((name) => !all.includes(name));
    if (absent.length > 0) {
      throw new ContractDefinitionError(
        'only',
        '',
        `в выборке контракты, которых нет ни ${here}, ни ${there}: ${absent.join(', ')}`,
      );
    }
  }
  const names = all
    .filter((name) => options.only === undefined || options.only.map((item) => item.trim()).includes(name))
    .sort();

  const directed = (outcome: CompareOutcome, direction: string): void => {
    const prefixed = (findings: readonly Finding[]): Finding[] =>
      findings.map((finding) => ({ ...finding, message: `${direction}: ${finding.message}` }));
    violations.push(...prefixed(outcome.violations));
    unproven.push(...prefixed(outcome.unproven));
    notes.push(...prefixed(outcome.notes));
  };
  const whole = (contract: string, code: Finding['code'], message: string): void => {
    violations.push({ contract, code, path: '', message });
  };
  const writes = (snapshot: ContractSnapshot): boolean => snapshot.role !== 'reader';
  const reads = (snapshot: ContractSnapshot): boolean => snapshot.role !== 'writer';
  /**
   * Поле версии — часть payload: писатель кладёт СВОЁ поле (`versionField`
   * его снимка) со своей версией, читатель снимает СВОЁ перед разбором. Форма
   * писателя сверяется вместе с его полем версии, форма читателя — с полем,
   * которое он снимает, поэтому строгий читатель, типизированный `catchall`,
   * корень-словарь и поле с тем же именем другого типа видны как нарушения
   * формы, а не как замечание.
   */
  const writerWire = (writer: ContractSnapshot): Shape =>
    writer.versionField === null
      ? writer.shape
      : withRootField(writer.shape, writer.versionField, {
          optional: false,
          shape: { kind: 'enum', values: [writer.version] },
        });
  const readerAccepts = (reader: ContractSnapshot): Shape =>
    reader.versionField === null
      ? reader.shape
      : withRootField(reader.shape, reader.versionField, { optional: true, shape: { kind: 'unknown' } });
  /** Найдёт ли читатель версию, которую кладёт писатель. */
  const versionFields = (
    name: string,
    writer: ContractSnapshot,
    reader: ContractSnapshot,
    direction: string,
  ): void => {
    if (writer.versionField === reader.versionField) {
      return;
    }
    const message = `${direction}: поле версии у писателя ${JSON.stringify(writer.versionField)}, читатель ищет ${JSON.stringify(reader.versionField)}`;
    if (reader.versionField === null) {
      // Поле версии придёт читателю обычным полем: что он с ним сделает, решает сверка формы.
      notes.push({
        contract: name,
        code: FINDING_CODE.versionFieldMismatch,
        path: '',
        message: `${message}: читатель версию не читает, поле придёт ему обычным полем`,
      });
    } else if (reader.legacyVersion === null) {
      whole(name, FINDING_CODE.versionFieldMismatch, `${message}: читатель не найдёт версию`);
    } else {
      notes.push({
        contract: name,
        code: FINDING_CODE.versionFieldMismatch,
        path: '',
        message: `${message}: payload прочитается как legacyVersion ${reader.legacyVersion}`,
      });
    }
  };
  /** Сверка формы писателя (с его полем версии) с формой читателя (без его поля версии). */
  const directedShapes = (
    name: string,
    writer: ContractSnapshot,
    reader: ContractSnapshot,
    direction: string,
  ): void => {
    const outcome = compareShapes(writerWire(writer), readerAccepts(reader), {
      contract: name,
      mode: mode === 'aligned' ? 'aligned' : 'compatible',
      writerExtraFields: writer.extraFields,
    });
    // «Читатель не читает поле версии» уже сказано замечанием version-field-mismatch.
    const own = (finding: Finding): boolean =>
      !(finding.code === FINDING_CODE.fieldUnread && finding.path === writer.versionField) &&
      !(finding.code === FINDING_CODE.fieldUnsent && finding.path === reader.versionField);
    directed(
      {
        violations: outcome.violations.filter(own),
        unproven: outcome.unproven.filter(own),
        notes: outcome.notes.filter(own),
      },
      direction,
    );
    const examples =
      writer.versionField === null
        ? writer.examples
        : writer.examples.map((example) =>
            typeof example === 'object' && example !== null && !Array.isArray(example)
              ? { ...(example as Record<string, unknown>), [writer.versionField as string]: writer.version }
              : example,
          );
    violations.push(...checkExamples(examples, readerAccepts(reader), { contract: name, direction }));
  };

  for (const name of names) {
    const own = Object.hasOwn(mine.contracts, name) ? mine.contracts[name] : undefined;
    const theirs = Object.hasOwn(peer.contracts, name) ? peer.contracts[name] : undefined;
    if (own === undefined || theirs === undefined) {
      whole(
        name,
        FINDING_CODE.contractMissing,
        own === undefined ? `контракт есть ${there}, нет ${here}` : `контракт есть ${here}, нет ${there}`,
      );
      continue;
    }
    const ownVersion = parseVersion(own.version);
    const theirVersion = parseVersion(theirs.version);
    if (ownVersion !== null && theirVersion !== null && ownVersion.major !== theirVersion.major) {
      whole(
        name,
        FINDING_CODE.majorMismatch,
        `мажор ${here} ${own.version}, ${there} ${theirs.version}: читатель отвергнет каждое сообщение`,
      );
      continue;
    }
    if (mode === 'mirror') {
      const policy = (
        label: string,
        mineValue: unknown,
        theirValue: unknown,
        code: Finding['code'] = FINDING_CODE.mirrorDifference,
      ): void => {
        if (mineValue !== theirValue) {
          whole(
            name,
            code,
            `${label} ${here} ${JSON.stringify(mineValue)}, ${there} ${JSON.stringify(theirValue)}`,
          );
        }
      };
      // Версии сравниваются разобранными: `1.2` и `1.2.0` — одна версия.
      if (!sameVersion(own.version, theirs.version)) {
        policy('версия', own.version, theirs.version);
      }
      policy('поле версии', own.versionField, theirs.versionField, FINDING_CODE.versionFieldMismatch);
      if (!sameVersion(own.legacyVersion, theirs.legacyVersion)) {
        policy('legacyVersion', own.legacyVersion, theirs.legacyVersion);
      }
      policy('политика записи extraFields', own.extraFields, theirs.extraFields);
      for (const finding of diffShapes(own.shape, theirs.shape, { contract: name, labels: [here, there] })) {
        (finding.code === FINDING_CODE.notProven ? unproven : violations).push(finding);
      }
      directed(
        compareWire(own.wire, theirs.wire, { contract: name, mode, labels: [here, there] }),
        'значения на проводе',
      );
      continue;
    }
    let paired = false;
    if (writes(own) && reads(theirs)) {
      paired = true;
      const direction = `${here} пишет → ${there} читает`;
      versionFields(name, own, theirs, direction);
      directedShapes(name, own, theirs, direction);
    }
    if (writes(theirs) && reads(own)) {
      paired = true;
      const direction = `${there} пишет → ${here} читает`;
      versionFields(name, theirs, own, direction);
      directedShapes(name, theirs, own, direction);
    }
    if (!paired) {
      whole(
        name,
        FINDING_CODE.rolesMismatch,
        `роль ${here} «${own.role}», ${there} «${theirs.role}»: никто не пишет то, что читает другая сторона`,
      );
    }
    directed(
      compareWire(own.wire, theirs.wire, { contract: name, mode, labels: [here, there] }),
      'значения на проводе',
    );
  }

  return toVerdict(violations, unproven, notes);
}
