import { FINDING_CODE } from '../constants/finding-code.constant';
import { stableJson } from '../shape/stable-json';
import type { CompareMode } from '../types/compare-mode.type';
import type { CompareOutcome } from '../types/compare-outcome.type';
import type { Finding } from '../types/finding.type';
import type { WireValue } from '../types/wire-value.type';
import { describeWireValue } from '../wire/describe-wire-value';

/**
 * Значения на проводе двух сторон (или двух версий одной). Разошедшееся
 * значение — всегда нарушение: ключ под другим именем не читается, очередь
 * под другим именем не разбирается. Значение, которое есть у другой стороны
 * и пропало здесь, — нарушение (она им пользуется); новое значение, которого
 * другая сторона ещё не знает, — в режиме `compatible` замечание, в `aligned`
 * и `mirror` — нарушение.
 */
export function compareWire(
  mine: Readonly<Record<string, WireValue>>,
  peer: Readonly<Record<string, WireValue>>,
  options: {
    readonly contract: string;
    readonly mode: CompareMode;
    readonly labels?: readonly [string, string];
  },
): CompareOutcome {
  const [here, there] = options.labels ?? ['здесь', 'у другой стороны'];
  const violations: Finding[] = [];
  const notes: Finding[] = [];
  const finding = (code: Finding['code'], path: string, message: string): Finding => ({
    contract: options.contract,
    code,
    path: `wire:${path}`,
    message: `wire «${path}»: ${message}`,
  });
  for (const path of [...new Set([...Object.keys(mine), ...Object.keys(peer)])].sort()) {
    const own = Object.hasOwn(mine, path) ? mine[path] : undefined;
    const theirs = Object.hasOwn(peer, path) ? peer[path] : undefined;
    if (own !== undefined && theirs !== undefined) {
      if (stableJson(own) !== stableJson(theirs)) {
        violations.push(
          finding(
            FINDING_CODE.wireConstantChanged,
            path,
            `${here} ${describeWireValue(own)}, ${there} ${describeWireValue(theirs)}`,
          ),
        );
      }
    } else if (theirs !== undefined) {
      violations.push(
        finding(
          FINDING_CODE.wireConstantMissing,
          path,
          `есть ${there} (${describeWireValue(theirs)}), нет ${here}`,
        ),
      );
    } else if (own !== undefined) {
      const unknown = finding(
        FINDING_CODE.wireConstantUnknown,
        path,
        `есть ${here} (${describeWireValue(own)}), нет ${there}`,
      );
      (options.mode === 'compatible' ? notes : violations).push(unknown);
    }
  }
  return { violations, unproven: [], notes };
}
