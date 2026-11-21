import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyKnown } from '../compare/apply-known';
import { checkEvolution } from '../compare/check-evolution';
import { compareSnapshots } from '../compare/compare-snapshots';
import { findingKey } from '../compare/finding-key';
import { toVerdict } from '../compare/to-verdict';
import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { FINDING_CODE } from '../constants/finding-code.constant';
import { describeThrown } from '../runtime/describe-thrown';
import { stableJson } from '../shape/stable-json';
import { parseSnapshot } from '../snapshot/parse-snapshot';
import { writeSnapshot } from '../snapshot/write-snapshot';
import { describeSource } from '../sources/describe-source';
import { loadPeerSnapshot } from '../sources/load-peer-snapshot';
import { resolvePeerSource } from '../sources/resolve-peer-source';
import type { ContractsGateOptions } from '../types/contracts-gate-options.type';
import type { Finding } from '../types/finding.type';
import type { GateCheck } from '../types/gate-check.type';
import type { PeerSource } from '../types/peer-source.type';
import type { SnapshotDocument } from '../types/snapshot-document.type';
import type { Verdict } from '../types/verdict.type';

/**
 * Проверки гейта контрактов — без jest: заголовок `describe` и список
 * `{ name, run }`, где `run` бросает ошибку с причиной. `contractsGate`
 * только регистрирует их как `it`; логика проверяется в процессе спеки, а не
 * через собранный пакет.
 *
 * - снимок, собранный из кода, совпадает с закоммиченным — по СОДЕРЖАНИЮ, а
 *   не по тексту; `CONTRACTS_UPDATE=1` переписывает файл через форматтер;
 * - выборка не выродилась (`minContracts`);
 * - изменение против прежнего снимка своей стороны (`previous`);
 * - по каждой другой стороне: снимок добыт (не добыт — КРАСНЫЙ, а не пропуск),
 *   нарушений нет, «не доказано» нет, известные расхождения — с причиной и
 *   всё ещё есть; образцы писателя разбираются настоящей схемой (`runtime`).
 */
export function gateChecks(options: ContractsGateOptions): {
  readonly title: string;
  readonly checks: readonly GateCheck[];
} {
  if (!(options.minContracts >= 1)) {
    throw new Error('contractsGate: minContracts обязан быть не меньше 1 — иначе «совпало» на пустом снимке');
  }
  const minReason = options.minReasonLength ?? 30;
  const checks: GateCheck[] = [];
  const check = (name: string, run: () => void): void => {
    checks.push({ name, run });
  };
  let own: SnapshotDocument | undefined;
  const mine = (): SnapshotDocument => {
    own ??= options.snapshot();
    return own;
  };
  const listed = (findings: readonly Finding[]): string =>
    findings.map((finding) => `  ${findingKey(finding)} — ${finding.message}`).join('\n');
  const load = (source: PeerSource): (() => SnapshotDocument) => {
    let outcome: { readonly document?: SnapshotDocument; readonly error?: Error } | undefined;
    return () => {
      if (outcome === undefined) {
        try {
          // Относительные пути — от root гейта, а не от каталога, из которого запущен jest.
          outcome = { document: loadPeerSnapshot(resolvePeerSource(source, options.root)) };
        } catch (error) {
          outcome = { error: error instanceof Error ? error : new Error(describeThrown(error)) };
        }
      }
      if (outcome.error !== undefined) {
        throw outcome.error;
      }
      return outcome.document as SnapshotDocument;
    };
  };
  const knownChecks = (
    label: string,
    verdict: () => Verdict,
    known: Readonly<Record<string, string>> | undefined,
  ): void => {
    check(`${label}: нарушений вне известных расхождений нет`, () => {
      const open = applyKnown(verdict(), known ?? {}, minReason).verdict.violations;
      if (open.length > 0) {
        throw new Error(`${label}: нарушений ${open.length}:\n${listed(open)}`);
      }
    });
    check(`${label}: «не доказано» вне известных расхождений нет`, () => {
      const open = applyKnown(verdict(), known ?? {}, minReason).verdict.unproven;
      if (open.length > 0) {
        throw new Error(`${label}: не доказано ${open.length}:\n${listed(open)}`);
      }
    });
    if (known !== undefined && Object.keys(known).length > 0) {
      check(`${label}: известные расхождения — с причиной и всё ещё есть`, () => {
        const outcome = applyKnown(verdict(), known, minReason);
        if (outcome.stale.length > 0 || outcome.unexplained.length > 0) {
          throw new Error(
            `${label}: устарели — ${outcome.stale.join(', ') || 'нет'}; без причины — ${outcome.unexplained.join(', ') || 'нет'}`,
          );
        }
      });
    }
  };

  check(`снимок совпадает с закоммиченным (${options.committed})`, () => {
    const path = join(options.root, options.committed);
    if (process.env[CONTRACT_FORMAT.UPDATE_ENV] === '1') {
      // В CI переписанный снимок сравнивался бы сам с собой: проверка зелёная всегда.
      const ci = process.env.CI;
      if (ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false') {
        throw new Error(
          `${CONTRACT_FORMAT.UPDATE_ENV}=1 в CI (CI=${ci}): снимок переписался бы и совпал сам с собой — проверка была бы зелёной всегда. Пересобирайте снимок локально и коммитьте`,
        );
      }
      writeSnapshot(path, mine(), {
        cwd: options.root,
        ...(options.formatter === undefined ? {} : { formatter: options.formatter }),
      });
    }
    if (!existsSync(path)) {
      throw new Error(
        `нет закоммиченного снимка ${options.committed}: собрать — ${CONTRACT_FORMAT.UPDATE_ENV}=1`,
      );
    }
    const committed = parseSnapshot(readFileSync(path, 'utf8'), options.committed);
    const generated = mine();
    const names = [
      ...new Set([...Object.keys(committed.contracts), ...Object.keys(generated.contracts)]),
    ].sort();
    const stale = names.filter(
      (name) =>
        stableJson(Object.hasOwn(committed.contracts, name) ? committed.contracts[name] : null) !==
        stableJson(Object.hasOwn(generated.contracts, name) ? generated.contracts[name] : null),
    );
    if (stale.length > 0) {
      // Расходятся — пересобрать: CONTRACTS_UPDATE=1 и закоммитить вместе с изменением кода.
      throw new Error(
        `снимок ${options.committed} устарел: ${stale.join(', ')} — пересобрать (${CONTRACT_FORMAT.UPDATE_ENV}=1)`,
      );
    }
  });

  check(`выборка не выродилась: контрактов не меньше ${options.minContracts}`, () => {
    const count = Object.keys(mine().contracts).length;
    if (count < options.minContracts) {
      throw new Error(`контрактов в снимке ${count}, ожидалось не меньше ${options.minContracts}`);
    }
  });

  if (options.previous !== undefined) {
    const previous = load(options.previous.source);
    const label = `изменение против ${describeSource(options.previous.source)}`;
    check(`${label}: прежний снимок добыт`, () => {
      previous();
    });
    knownChecks(label, () => checkEvolution(previous(), mine()), options.previous.known);
  }

  for (const peer of options.peers ?? []) {
    const theirs = load(peer.source);
    const mode = peer.mode ?? 'compatible';
    check(`${peer.name}: снимок другой стороны добыт (${describeSource(peer.source)})`, () => {
      theirs();
    });
    const verdict = (): Verdict => {
      const base = compareSnapshots(mine(), theirs(), {
        mode,
        labels: ['здесь', peer.name],
        ...(peer.only === undefined ? {} : { only: peer.only }),
      });
      const rejected: Finding[] = [];
      // Выборка only ограничивает и разбор образцов: вне выборки сторона сверку не заказывала.
      const selected = peer.only?.map((name) => name.trim());
      for (const contract of options.runtime ?? []) {
        if (selected !== undefined && !selected.includes(contract.name)) {
          continue;
        }
        const peerContracts = theirs().contracts;
        const entry = Object.hasOwn(peerContracts, contract.name) ? peerContracts[contract.name] : undefined;
        const ownContracts = mine().contracts;
        const local = Object.hasOwn(ownContracts, contract.name) ? ownContracts[contract.name] : undefined;
        if (
          entry === undefined ||
          local === undefined ||
          entry.role === 'reader' ||
          local.role === 'writer'
        ) {
          continue;
        }
        entry.examples.forEach((example, index) => {
          // Поле версии кладёт ПИСАТЕЛЬ — своё (из его снимка), а не то, которое ищет читатель.
          const payload =
            entry.versionField === null ||
            typeof example !== 'object' ||
            example === null ||
            Array.isArray(example)
              ? example
              : { ...(example as Record<string, unknown>), [entry.versionField]: entry.version };
          const reject = (reason: string): void => {
            rejected.push({
              contract: contract.name,
              code: FINDING_CODE.exampleRejected,
              path: `examples[${index}]`,
              message: `${peer.name} пишет → здесь читает: схема читателя отвергла образец #${index + 1}: ${reason}`,
            });
          };
          try {
            const outcome = contract.read(payload) as { then?: unknown } | null;
            if (
              (typeof outcome === 'object' || typeof outcome === 'function') &&
              outcome !== null &&
              typeof outcome.then === 'function'
            ) {
              // Асинхронное чтение гейт не дождётся: отклонение не должно остаться необработанным.
              (outcome as PromiseLike<unknown>).then(
                () => undefined,
                () => undefined,
              );
              reject('read вернул Promise — гейт проверяет только синхронное чтение');
            }
          } catch (error) {
            reject(describeThrown(error, 'message'));
          }
        });
      }
      return toVerdict([...base.violations, ...rejected], base.unproven, base.notes);
    };
    knownChecks(`${peer.name}: совместимость (${mode})`, verdict, peer.known);
  }

  return { title: options.title ?? 'контракты', checks };
}
