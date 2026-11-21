import type { FieldShape } from './field-shape.type';

/**
 * Каноническая форма значения на проводе (JSON) — то, что попадает в снимок
 * контракта. Описывается ВХОД: что писатель вправе положить и что читатель
 * примет.
 *
 * - `enum` — набор строк на проводе: `z.enum`, `z.literal('x')`, объединение
 *   строковых литералов TypeScript и строковые enum сводятся к одному виду,
 *   поэтому разная запись одного и того же набора не даёт расхождения;
 * - `literal` — число или булево значение литералом;
 * - `object.unknownKeys` — что читатель делает с полем, которого не знает:
 *   `strip` — молча выбрасывает (`z.object`, интерфейс TypeScript), `reject` —
 *   отвергает сообщение (`z.strictObject`), `keep` — сохраняет (`z.looseObject`,
 *   `catchall`, индексная сигнатура; тип лишних полей — `rest`);
 * - `undefined` — только вне поля объекта (элемент массива, член кортежа):
 *   у поля необязательность — флаг `optional`.
 *
 * - `opaque` — семантика, которую форма не выражает целиком (`coerce`,
 *   `preprocess`, `transform`, `refine`, проверка после `trim`, `catch`,
 *   `xor` с пересекающимися вариантами…). `upper` — НАДМНОЖЕСТВО принимаемого:
 *   вне него читатель отвергает наверняка, писатель за него не выходит;
 *   `lower` — ПОДМНОЖЕСТВО, принятое наверняка (нет — наверняка ничего).
 *   Сверка с таким читателем доказывает совместимость, только если писатель
 *   укладывается в `lower`; иначе — «не доказано», а не «совместимо».
 *   `exact` — приём ровно как у `upper`, а узел меняет только ВЫХОД
 *   (`default`, `trim`, `toLowerCase`): сверка приёма точная, зеркало видит
 *   разницу. `semantics` — поведение узла описано целиком без функций
 *   пользователя (подстановка по умолчанию, встроенная нормализация и
 *   проверки после неё, `coerce` к типу): два узла с одинаковыми
 *   `semantics`, `upper` и `lower` ведут себя одинаково. Текст `reason` —
 *   для человека и в сравнении не участвует.
 *
 * `codePoints` — длина строки считается кодовыми точками (zod 4.6+), а не
 * единицами UTF-16 (`'😀'` — 1 против 2): при одних и тех же `min`/`max`
 * стороны на разных минорах zod принимают разное.
 *
 * Ограничения (`minLength`, `patterns` — литералы `/…/флаги`, `formats` — имя
 * формата с параметрами, `minimum`, `integer`…) входят в форму: читатель,
 * ставший строже писателя, отвергнет то, что тот шлёт.
 */
export type Shape =
  | {
      readonly kind: 'string';
      readonly minLength?: number;
      readonly maxLength?: number;
      readonly patterns?: readonly string[];
      readonly formats?: readonly string[];
      readonly codePoints?: true;
    }
  | {
      readonly kind: 'number';
      readonly integer?: true;
      readonly minimum?: number;
      readonly exclusiveMinimum?: number;
      readonly maximum?: number;
      readonly exclusiveMaximum?: number;
      readonly multipleOf?: number;
    }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'bigint' }
  | { readonly kind: 'date' }
  | { readonly kind: 'null' }
  | { readonly kind: 'undefined' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'never' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'literal'; readonly value: number | boolean }
  | { readonly kind: 'template'; readonly pattern: string }
  | {
      readonly kind: 'object';
      readonly fields: Readonly<Record<string, FieldShape>>;
      readonly unknownKeys: 'strip' | 'reject' | 'keep';
      readonly rest?: Shape;
    }
  | { readonly kind: 'record'; readonly key: Shape; readonly value: Shape }
  | {
      readonly kind: 'array';
      readonly element: Shape;
      readonly minItems?: number;
      readonly maxItems?: number;
    }
  | {
      readonly kind: 'tuple';
      readonly items: readonly Shape[];
      readonly rest?: Shape;
      /** Сколько членов кортеж требует на деле, если не столько, сколько следует из необязательных последних. */
      readonly minItems?: number;
    }
  | { readonly kind: 'union'; readonly options: readonly Shape[] }
  | {
      readonly kind: 'opaque';
      readonly reason: string;
      readonly upper: Shape;
      readonly lower?: Shape;
      readonly exact?: true;
      readonly semantics?: string;
    };
