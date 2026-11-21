import { FINDING_CODE } from '../constants/finding-code.constant';
import { canonicalShape } from '../shape/canonical-shape';
import { describeShape } from '../shape/describe-shape';
import { ownField } from '../shape/own-field';
import { shapeKey } from '../shape/shape-key';
import { stableJson } from '../shape/stable-json';
import { tupleMinimum } from '../shape/tuple-minimum';
import type { Finding } from '../types/finding.type';
import type { Shape } from '../types/shape.type';

/**
 * Режим зеркала: две копии одного контракта обязаны совпадать по форме
 * целиком — поля, обязательность, строки на проводе, ограничения, политика
 * неизвестных полей. Сравниваются РАЗОБРАННЫЕ формы, а не текст: перенос
 * строки, порядок полей, `'a' | 'b'` против `z.enum(['a', 'b'])` расхождения
 * не дают. Каждое различие — отдельная находка с путём (`mirror-difference`).
 *
 * Совпадение копий не доказывает совместимость там, где форма не выражает
 * семантику: две одинаково записанные `transform` могут вызывать разные
 * функции. Поэтому непрозрачный узел (`opaque`) — находка `not-proven`, а
 * значение, которое JSON не переносит (`Date`, `bigint`, `undefined` в
 * массиве), — `json-lossy`, даже если копии совпали.
 */
export function diffShapes(
  left: Shape,
  right: Shape,
  options: { readonly contract: string; readonly labels?: readonly [string, string] },
): Finding[] {
  const [here, there] = options.labels ?? ['здесь', 'там'];
  const findings: Finding[] = [];
  const at = (path: string): string => (path === '' ? 'корень' : `«${path}»`);
  const add = (path: string, message: string): void => {
    findings.push({
      contract: options.contract,
      code: FINDING_CODE.mirrorDifference,
      path,
      message: `${at(path)}: ${message}`,
    });
  };
  const join = (path: string, name: string): string => (path === '' ? name : `${path}.${name}`);
  const quoted = (values: readonly string[]): string => values.map((value) => `«${value}»`).join(', ');
  const constraints = (shape: Shape): string => {
    const { kind: _kind, ...rest } = shape as Shape & Record<string, unknown>;
    return stableJson(rest);
  };

  /** Непрозрачные узлы и то, что JSON не переносит, — в одной копии формы. */
  const hazards = (shape: Shape, path: string, inArray: boolean): void => {
    const push = (code: Finding['code'], message: string): void => {
      findings.push({ contract: options.contract, code, path, message: `${at(path)}: ${message}` });
    };
    switch (shape.kind) {
      case 'opaque':
        // Поведение описано целиком (default, встроенная нормализация, coerce): одинаковые копии — одинаковое поведение.
        if (shape.semantics === undefined) {
          push(
            FINDING_CODE.notProven,
            `${describeShape(shape)} — совпадение копий не доказывает, что семантика вне формы одна и та же`,
          );
          return;
        }
        hazards(shape.upper, path, inArray);
        return;
      case 'date':
      case 'bigint':
        push(FINDING_CODE.jsonLossy, `${describeShape(shape)} не переживает JSON`);
        return;
      case 'undefined':
        if (inArray) {
          push(FINDING_CODE.jsonLossy, 'undefined в массиве по JSON едет как null');
        }
        return;
      case 'object':
        for (const [name, field] of Object.entries(shape.fields)) {
          hazards(field.shape, join(path, name), false);
        }
        if (shape.rest !== undefined) {
          hazards(shape.rest, `${path}{*}`, false);
        }
        return;
      case 'record':
        hazards(shape.value, `${path}{*}`, false);
        return;
      case 'array':
        hazards(shape.element, `${path}[]`, true);
        return;
      case 'tuple':
        shape.items.forEach((item, index) => {
          hazards(item, `${path}[${index}]`, true);
        });
        if (shape.rest !== undefined) {
          hazards(shape.rest, `${path}[...]`, true);
        }
        return;
      case 'union':
        for (const option of shape.options) {
          hazards(option, path, inArray);
        }
        return;
      default:
        return;
    }
  };

  const visit = (a: Shape, b: Shape, path: string): void => {
    // Текст причины непрозрачного узла — для человека: копии сравниваются без него.
    if (shapeKey(a) === shapeKey(b)) {
      return;
    }
    if (a.kind !== b.kind) {
      add(path, `${here} ${describeShape(a)}, ${there} ${describeShape(b)}`);
      return;
    }
    switch (a.kind) {
      case 'object': {
        const other = b as typeof a;
        const onlyHere = Object.keys(a.fields).filter((name) => !Object.hasOwn(other.fields, name));
        const onlyThere = Object.keys(other.fields).filter((name) => !Object.hasOwn(a.fields, name));
        for (const name of onlyHere) {
          add(join(path, name), `поле есть ${here}, нет ${there}`);
        }
        for (const name of onlyThere) {
          add(join(path, name), `поле есть ${there}, нет ${here}`);
        }
        for (const [name, field] of Object.entries(a.fields)) {
          const twin = ownField(other.fields, name);
          if (twin === undefined) {
            continue;
          }
          if (field.optional !== twin.optional) {
            add(
              join(path, name),
              `${here} ${field.optional ? 'необязательное' : 'обязательное'}, ${there} ${twin.optional ? 'необязательное' : 'обязательное'}`,
            );
          }
          if ((field.undefinedAccepted === true) !== (twin.undefinedAccepted === true)) {
            const shown = (accepted: boolean): string =>
              accepted ? 'принимает явное undefined' : 'явное undefined не принимает';
            add(
              join(path, name),
              `${here} ${shown(field.undefinedAccepted === true)}, ${there} ${shown(twin.undefinedAccepted === true)} (писатель с undefined по JSON теряет поле)`,
            );
          }
          visit(field.shape, twin.shape, join(path, name));
        }
        if (a.unknownKeys !== other.unknownKeys) {
          const policy = { strip: 'выбрасывает', reject: 'отвергает', keep: 'сохраняет' } as const;
          add(
            path,
            `неизвестные поля ${here} ${policy[a.unknownKeys]}, ${there} ${policy[other.unknownKeys]}`,
          );
        } else if (a.unknownKeys === 'keep') {
          visit(a.rest ?? { kind: 'unknown' }, other.rest ?? { kind: 'unknown' }, `${path}{*}`);
        }
        return;
      }
      case 'enum': {
        const other = b as typeof a;
        const onlyHere = a.values.filter((value) => !other.values.includes(value));
        const onlyThere = other.values.filter((value) => !a.values.includes(value));
        if (onlyHere.length > 0) {
          add(path, `строки на проводе только ${here}: ${quoted(onlyHere)}`);
        }
        if (onlyThere.length > 0) {
          add(path, `строки на проводе только ${there}: ${quoted(onlyThere)}`);
        }
        return;
      }
      case 'array': {
        const other = b as typeof a;
        if (a.minItems !== other.minItems || a.maxItems !== other.maxItems) {
          add(
            path,
            `границы длины ${here} [${a.minItems ?? 0}, ${a.maxItems ?? '∞'}], ${there} [${other.minItems ?? 0}, ${other.maxItems ?? '∞'}]`,
          );
        }
        visit(a.element, other.element, `${path}[]`);
        return;
      }
      case 'record': {
        const other = b as typeof a;
        visit(a.key, other.key, `${path}{key}`);
        visit(a.value, other.value, `${path}{*}`);
        return;
      }
      case 'tuple': {
        const other = b as typeof a;
        if (a.items.length !== other.items.length) {
          add(path, `кортеж ${here} из ${a.items.length}, ${there} из ${other.items.length}`);
        } else if (tupleMinimum(a) !== tupleMinimum(other)) {
          add(path, `кортеж ${here} требует ${tupleMinimum(a)} членов, ${there} — ${tupleMinimum(other)}`);
        }
        a.items.forEach((item, index) => {
          const twin = other.items[index];
          if (twin !== undefined) {
            visit(item, twin, `${path}[${index}]`);
          }
        });
        if ((a.rest === undefined) !== (other.rest === undefined)) {
          add(
            path,
            `хвост кортежа ${a.rest === undefined ? there : here}, нет ${a.rest === undefined ? here : there}`,
          );
        } else if (a.rest !== undefined && other.rest !== undefined) {
          visit(a.rest, other.rest, `${path}[...]`);
        }
        return;
      }
      case 'union': {
        const other = b as typeof a;
        const keys = new Set(other.options.map((option) => shapeKey(option)));
        const ownKeys = new Set(a.options.map((option) => shapeKey(option)));
        const onlyHere = a.options.filter((option) => !keys.has(shapeKey(option)));
        const onlyThere = other.options.filter((option) => !ownKeys.has(shapeKey(option)));
        const [single] = onlyHere;
        const [twin] = onlyThere;
        if (
          onlyHere.length === 1 &&
          onlyThere.length === 1 &&
          single !== undefined &&
          twin !== undefined &&
          single.kind === twin.kind
        ) {
          visit(single, twin, path);
          return;
        }
        for (const option of onlyHere) {
          add(path, `вариант ${describeShape(option)} есть ${here}, нет ${there}`);
        }
        for (const option of onlyThere) {
          add(path, `вариант ${describeShape(option)} есть ${there}, нет ${here}`);
        }
        return;
      }
      case 'opaque': {
        const other = b as typeof a;
        if (a.semantics !== other.semantics || (a.exact === true) !== (other.exact === true)) {
          add(
            path,
            `поведение ${here} «${a.semantics ?? a.reason}», ${there} «${other.semantics ?? other.reason}»`,
          );
        }
        visit(a.upper, other.upper, path);
        if (shapeKey(a.lower ?? null) !== shapeKey(other.lower ?? null)) {
          add(
            path,
            `принято наверняка ${here} ${a.lower === undefined ? 'ничего' : describeShape(a.lower)}, ${there} ${other.lower === undefined ? 'ничего' : describeShape(other.lower)}`,
          );
        }
        return;
      }
      default:
        add(path, `ограничения ${here} ${constraints(a)}, ${there} ${constraints(b)}`);
    }
  };

  const a = canonicalShape(left);
  const b = canonicalShape(right);
  visit(a, b, '');
  hazards(a, '', false);
  hazards(b, '', false);
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code} ${finding.path} ${finding.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
