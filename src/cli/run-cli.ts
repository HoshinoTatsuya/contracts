import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyKnown } from '../compare/apply-known';
import { checkEvolution } from '../compare/check-evolution';
import { compareSnapshots } from '../compare/compare-snapshots';
import { formatVerdict } from '../compare/format-verdict';
import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import { SnapshotFormatError } from '../errors/snapshot-format.error';
import { describeThrown } from '../runtime/describe-thrown';
import { stableJson } from '../shape/stable-json';
import { parseSnapshot } from '../snapshot/parse-snapshot';
import { writeSnapshot } from '../snapshot/write-snapshot';
import { loadPeerSnapshot } from '../sources/load-peer-snapshot';
import { parsePeerSource } from '../sources/parse-peer-source';
import { recordDeployed } from '../sources/record-deployed';
import { resolvePeerSource } from '../sources/resolve-peer-source';
import type { CliIo } from '../types/cli-io.type';
import type { CompareMode } from '../types/compare-mode.type';
import type { PeerSource } from '../types/peer-source.type';
import type { SnapshotFormatter } from '../types/snapshot-formatter.type';
import type { Verdict } from '../types/verdict.type';
import { loadSnapshotModule } from './load-snapshot-module';
import { parseFlags } from './parse-flags';

/**
 * CLI `contracts` для джобы CI. Коды выхода: 0 — совместимо / актуально,
 * 1 — нарушения (или устаревшие известные расхождения), 2 — НЕ ПРОВЕРЕНО
 * (снимок другой стороны не добыт, неверные аргументы, выборка `--only`
 * выродилась), 3 — НЕ ДОКАЗАНО (нарушений нет, но совместимость там, где
 * форма не выражает семантику, не доказана и не внесена в известные). 2 и 3 —
 * не «зелёный с оговоркой»: джоба красная, но причина видна отдельно от
 * нарушений.
 *
 * ```
 * contracts snapshot --from dist/contracts.js --out contracts.snapshot.json [--formatter biome]
 * contracts verify   --from dist/contracts.js --snapshot contracts.snapshot.json
 * contracts check    --mine contracts.snapshot.json --peer deployed:contracts/peer.deployed.json@../peer
 *                    [--mode compatible|aligned|mirror] [--known known.json] [--only a,b] [--json]
 * contracts evolve   --previous git:.#origin/main:contracts.snapshot.json --next contracts.snapshot.json
 * contracts record-deployed --peer <имя> --ref <хэш> --snapshot-path contracts.snapshot.json --out <файл>
 * ```
 */
export function runCli(argv: readonly string[], io: CliIo): number {
  const [command, ...args] = argv;
  const usage =
    'использование: contracts <snapshot|verify|check|evolve|record-deployed> [флаги]; подробности — README пакета';
  const report = (
    verdict: Verdict,
    title: string,
    known: Readonly<Record<string, string>>,
    json: boolean,
  ): number => {
    const outcome = applyKnown(verdict, known);
    if (json) {
      io.stdout(
        `${stableJson({ ...outcome.verdict, stale: outcome.stale, unexplained: outcome.unexplained }, 2)}\n`,
      );
    } else {
      io.stdout(`${formatVerdict(outcome.verdict, title)}\n`);
      for (const key of outcome.stale) {
        io.stdout(`  ✗ известное расхождение устарело: ${key}\n`);
      }
      for (const key of outcome.unexplained) {
        io.stdout(`  ✗ известное расхождение без причины: ${key}\n`);
      }
    }
    if (outcome.verdict.violations.length > 0 || outcome.stale.length > 0 || outcome.unexplained.length > 0) {
      return 1;
    }
    return outcome.verdict.unproven.length > 0 ? 3 : 0;
  };
  const readKnown = (file: string | undefined): Readonly<Record<string, string>> => {
    if (file === undefined) {
      return {};
    }
    const path = resolve(io.cwd, file);
    if (!existsSync(path)) {
      throw new SnapshotFormatError(path, 'нет файла известных расхождений');
    }
    const known = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof known !== 'object' || known === null || Array.isArray(known)) {
      throw new SnapshotFormatError(path, 'известные расхождения — не словарь «адрес → причина»');
    }
    return known as Record<string, string>;
  };
  // Относительные пути — от рабочего каталога CLI, а не процесса.
  const source = (text: string): PeerSource => resolvePeerSource(parsePeerSource(text), io.cwd);

  try {
    switch (command) {
      case 'snapshot': {
        const flags = parseFlags(args, ['from', 'out', 'formatter']);
        if (flags.from === undefined || flags.out === undefined) {
          throw new Error('нужны --from и --out');
        }
        const formatter = (flags.formatter ?? 'none') as SnapshotFormatter;
        if (!['none', 'biome', 'prettier'].includes(formatter as string)) {
          throw new Error(`неизвестный форматтер ${String(formatter)}`);
        }
        const document = loadSnapshotModule(flags.from, io.cwd);
        writeSnapshot(flags.out, document, { formatter, cwd: io.cwd });
        io.stdout(`снимок записан: ${flags.out} (контрактов ${Object.keys(document.contracts).length})\n`);
        return 0;
      }
      case 'verify': {
        const flags = parseFlags(args, ['from', 'snapshot']);
        if (flags.from === undefined || flags.snapshot === undefined) {
          throw new Error('нужны --from и --snapshot');
        }
        const generated = loadSnapshotModule(flags.from, io.cwd);
        const path = resolve(io.cwd, flags.snapshot);
        if (!existsSync(path)) {
          io.stdout(`✗ нет закоммиченного снимка ${flags.snapshot}\n`);
          return 1;
        }
        const committed = parseSnapshot(readFileSync(path, 'utf8'), flags.snapshot);
        const names = [
          ...new Set([...Object.keys(committed.contracts), ...Object.keys(generated.contracts)]),
        ].sort();
        const stale = names.filter(
          (name) =>
            stableJson(Object.hasOwn(committed.contracts, name) ? committed.contracts[name] : null) !==
            stableJson(Object.hasOwn(generated.contracts, name) ? generated.contracts[name] : null),
        );
        if (stale.length > 0) {
          io.stdout(
            `✗ снимок ${flags.snapshot} устарел: ${stale.join(', ')} — пересобрать \`contracts snapshot\`\n`,
          );
          return 1;
        }
        io.stdout(`снимок ${flags.snapshot} актуален (контрактов ${names.length})\n`);
        return names.length === 0 ? 1 : 0;
      }
      case 'check': {
        const flags = parseFlags(args, ['mine', 'peer', 'mode', 'known', 'only'], ['json']);
        if (flags.mine === undefined || flags.peer === undefined) {
          throw new Error('нужны --mine и --peer');
        }
        const mode = (flags.mode ?? 'compatible') as CompareMode;
        if (!['compatible', 'aligned', 'mirror'].includes(mode)) {
          throw new Error(`неизвестный режим ${mode}`);
        }
        const known = readKnown(flags.known);
        const mine = loadPeerSnapshot(source(flags.mine));
        const peer = loadPeerSnapshot(source(flags.peer));
        if (Object.keys(mine.contracts).length === 0) {
          throw new PeerSnapshotUnavailableError(flags.mine, 'в своём снимке нет ни одного контракта');
        }
        const verdict = compareSnapshots(mine, peer, {
          mode,
          ...(flags.only === undefined ? {} : { only: flags.only.split(',').map((name) => name.trim()) }),
        });
        return report(verdict, `сверка с ${flags.peer} (${mode})`, known, flags.json === 'true');
      }
      case 'evolve': {
        const flags = parseFlags(args, ['previous', 'next', 'known'], ['json']);
        if (flags.previous === undefined || flags.next === undefined) {
          throw new Error('нужны --previous и --next');
        }
        const known = readKnown(flags.known);
        const verdict = checkEvolution(
          loadPeerSnapshot(source(flags.previous)),
          loadPeerSnapshot(source(flags.next)),
        );
        return report(verdict, `изменение против ${flags.previous}`, known, flags.json === 'true');
      }
      case 'record-deployed': {
        const flags = parseFlags(args, ['peer', 'ref', 'snapshot-path', 'out']);
        if (
          flags.peer === undefined ||
          flags.ref === undefined ||
          flags['snapshot-path'] === undefined ||
          flags.out === undefined
        ) {
          throw new Error('нужны --peer, --ref, --snapshot-path и --out');
        }
        recordDeployed(resolve(io.cwd, flags.out), {
          peer: flags.peer,
          ref: flags.ref,
          snapshotPath: flags['snapshot-path'],
        });
        io.stdout(`записано: ${flags.peer} развёрнут на ${flags.ref}\n`);
        return 0;
      }
      default:
        io.stderr(`${usage}\n`);
        return 2;
    }
  } catch (error) {
    io.stderr(`НЕ ПРОВЕРЕНО: ${describeThrown(error, 'message')}\n`);
    return 2;
  }
}
