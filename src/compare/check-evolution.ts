import { FINDING_CODE } from '../constants/finding-code.constant';
import { shapeKey } from '../shape/shape-key';
import { stableJson } from '../shape/stable-json';
import type { CompareOutcome } from '../types/compare-outcome.type';
import type { Finding } from '../types/finding.type';
import type { SnapshotDocument } from '../types/snapshot-document.type';
import type { Verdict } from '../types/verdict.type';
import { compareVersions } from '../version/compare-versions';
import { parseVersion } from '../version/parse-version';
import { sameVersion } from '../version/same-version';
import { checkExamples } from './check-examples';
import { compareShapes } from './compare-shapes';
import { compareWire } from './compare-wire';
import { toVerdict } from './to-verdict';

/**
 * Изменение СВОЕГО контракта относительно прежнего снимка (закоммиченного,
 * из ветки по умолчанию, развёрнутого): другая сторона ещё живёт на прежней
 * версии, поэтому проверяется то, что сломает её.
 *
 * - сторона пишет — новая форма писателя (с новой политикой записи) против
 *   прежней формы читателя: удалённое поле, новое обязательное, сменившийся
 *   тип, новая строка на проводе, поля вне формы на проводе;
 * - сторона читает — прежняя форма писателя против новой формы читателя:
 *   новое обязательное поле, сужение набора строк, строгость к неизвестным
 *   полям, снятый `legacyVersion` (прежние писатели без версии);
 * - `both` — оба направления.
 *
 * Непрозрачный узел, одинаковый в обеих версиях на одном пути, — замечание,
 * а не «не доказано»: форма вокруг него не менялась (изменение самой функции
 * снимок не видит — это сказано в замечании).
 *
 * Мажор поднят — проверка формы не делается: несовместимость объявлена, и
 * читатель прежнего мажора отвергнет сообщение громко (замечание об этом
 * остаётся). Форма, значения на проводе или политика изменились, а версия та
 * же (сравнивается разобранная версия: `1.2` и `1.2.0` — одна), — нарушение:
 * на рантайме изменение было бы неразличимо. Удалённый контракт и пропавшее
 * значение на проводе — нарушения.
 */
export function checkEvolution(previous: SnapshotDocument, next: SnapshotDocument): Verdict {
  const violations: Finding[] = [];
  const unproven: Finding[] = [];
  const notes: Finding[] = [];
  const directed = (outcome: CompareOutcome, direction: string): void => {
    const prefixed = (findings: readonly Finding[]): Finding[] =>
      findings.map((finding) => ({ ...finding, message: `${direction}: ${finding.message}` }));
    violations.push(...prefixed(outcome.violations));
    unproven.push(...prefixed(outcome.unproven));
    notes.push(...prefixed(outcome.notes));
  };

  for (const name of [
    ...new Set([...Object.keys(previous.contracts), ...Object.keys(next.contracts)]),
  ].sort()) {
    const before = Object.hasOwn(previous.contracts, name) ? previous.contracts[name] : undefined;
    const after = Object.hasOwn(next.contracts, name) ? next.contracts[name] : undefined;
    if (before === undefined) {
      notes.push({ contract: name, code: FINDING_CODE.contractMissing, path: '', message: 'новый контракт' });
      continue;
    }
    if (after === undefined) {
      violations.push({
        contract: name,
        code: FINDING_CODE.contractMissing,
        path: '',
        message: 'контракт удалён, а другая сторона может быть ещё на прежней версии',
      });
      continue;
    }
    const oldVersion = parseVersion(before.version);
    const newVersion = parseVersion(after.version);
    if (oldVersion !== null && newVersion !== null && compareVersions(newVersion, oldVersion) < 0) {
      violations.push({
        contract: name,
        code: FINDING_CODE.versionDecreased,
        path: '',
        message: `версия снизилась: ${before.version} → ${after.version}`,
      });
    }
    // Текст причины непрозрачного узла в сравнение не входит: формулировка — не изменение контракта.
    const changed =
      shapeKey(before.shape) !== shapeKey(after.shape) ||
      stableJson(before.wire) !== stableJson(after.wire) ||
      before.versionField !== after.versionField ||
      before.extraFields !== after.extraFields ||
      !sameVersion(before.legacyVersion, after.legacyVersion);
    if (changed && sameVersion(before.version, after.version)) {
      violations.push({
        contract: name,
        code: FINDING_CODE.versionNotBumped,
        path: '',
        message: `форма, значения на проводе или политика изменились, а версия та же (${before.version} → ${after.version})`,
      });
    }
    if (oldVersion !== null && newVersion !== null && newVersion.major !== oldVersion.major) {
      notes.push({
        contract: name,
        code: FINDING_CODE.majorMismatch,
        path: '',
        message: `мажор поднят ${before.version} → ${after.version}: читатели прежнего мажора отвергнут сообщения`,
      });
      continue;
    }
    if (before.versionField !== after.versionField) {
      violations.push({
        contract: name,
        code: FINDING_CODE.versionFieldMismatch,
        path: '',
        message: `поле версии сменилось без мажора: ${JSON.stringify(before.versionField)} → ${JSON.stringify(after.versionField)}`,
      });
    }
    if (after.role !== 'reader') {
      const direction = 'новая версия пишет → прежняя читает';
      directed(
        compareShapes(after.shape, before.shape, {
          contract: name,
          mode: 'compatible',
          writerExtraFields: after.extraFields,
          sameSource: true,
        }),
        direction,
      );
      violations.push(...checkExamples(after.examples, before.shape, { contract: name, direction }));
    }
    if (after.role !== 'writer') {
      const direction = 'прежняя версия пишет → новая читает';
      if (before.legacyVersion !== null && after.legacyVersion === null && after.versionField !== null) {
        violations.push({
          contract: name,
          code: FINDING_CODE.versionFieldMismatch,
          path: '',
          message: `${direction}: legacyVersion ${before.legacyVersion} снят — payload без версии от прежних писателей будет отвергнут`,
        });
      }
      directed(
        compareShapes(before.shape, after.shape, {
          contract: name,
          mode: 'compatible',
          writerExtraFields: before.extraFields,
          sameSource: true,
        }),
        direction,
      );
      violations.push(...checkExamples(before.examples, after.shape, { contract: name, direction }));
    }
    directed(
      compareWire(after.wire, before.wire, {
        contract: name,
        mode: 'compatible',
        labels: ['в новой версии', 'в прежней'],
      }),
      'значения на проводе',
    );
  }

  return toVerdict(violations, unproven, notes);
}
