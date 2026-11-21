import { deepFreeze } from '../deep-freeze';

/** Коды находок. Строки стабильны: ими адресуются известные расхождения (`known`). */
export const FINDING_CODE = {
  /** Читатель требует поле, писатель его не кладёт. */
  fieldRequiredMissing: 'field-required-missing',
  /** Читатель требует поле, писатель вправе его опустить. */
  fieldMayBeMissing: 'field-may-be-missing',
  /** Писатель кладёт поле, строгий читатель отвергнет сообщение целиком. */
  fieldRejected: 'field-rejected',
  /** Писатель кладёт поле, читатель его не знает и молча выбрасывает. */
  fieldUnread: 'field-unread',
  /** Читатель читает необязательное поле, писатель его не кладёт. */
  fieldUnsent: 'field-unsent',
  /** Писатель вправе слать произвольные поля, строгий читатель их отвергнет. */
  openToStrict: 'open-to-strict',
  /** Вид значения несовместим (строка против числа, объект против массива). */
  typeChanged: 'type-changed',
  /** Писатель вправе слать строку на проводе, которой читатель не знает. */
  wireValueUnknown: 'wire-value-unknown',
  /** Литерал разошёлся. */
  literalChanged: 'literal-changed',
  /** Читатель строже писателя: длина, шаблон, диапазон, целое. */
  constraintNarrowed: 'constraint-narrowed',
  /** Вариант объединения писателя не принимает ни один вариант читателя. */
  unionOptionUnmatched: 'union-option-unmatched',
  /**
   * Совместимость не доказана: форма не выражает семантику (`coerce`,
   * `preprocess`, `transform`, `refine`, проверка после `trim`, `catch`,
   * пересекающийся `xor`…) или писатель пропускает поля вне формы, которые
   * читатель проверит. Красное, пока не внесено в известные расхождения с
   * причиной.
   */
  notProven: 'not-proven',
  /** Значение не переживает JSON: `Date` (едет строкой), `bigint`, `undefined` в массиве (едет `null`). */
  jsonLossy: 'json-lossy',
  /** Длина кортежа разошлась. */
  tupleLength: 'tuple-length',
  /** Режим зеркала: копии различаются. */
  mirrorDifference: 'mirror-difference',
  /** Значение на проводе (очередь, ключ, маршрут) разошлось. */
  wireConstantChanged: 'wire-constant-changed',
  /** Значение на проводе есть у другой стороны и пропало здесь. */
  wireConstantMissing: 'wire-constant-missing',
  /** Значение на проводе есть здесь, другая сторона его не знает. */
  wireConstantUnknown: 'wire-constant-unknown',
  /** Контракт есть у одной стороны и нет у другой. */
  contractMissing: 'contract-missing',
  /** Ни одна из сторон не пишет то, что другая читает. */
  rolesMismatch: 'roles-mismatch',
  /** Мажорные версии разошлись: читатель отвергнет каждое сообщение. */
  majorMismatch: 'major-mismatch',
  /** Поле версии в payload у сторон разное: читатель не найдёт версию. */
  versionFieldMismatch: 'version-field-mismatch',
  /** Форма изменилась, версия та же: на рантайме изменение не различимо. */
  versionNotBumped: 'version-not-bumped',
  /** Версия снизилась относительно прежнего снимка. */
  versionDecreased: 'version-decreased',
  /** Образец писателя читатель не принимает. */
  exampleRejected: 'example-rejected',
  /** У маршрута контракта нет обработчика: вызов получит «no handler». */
  routeUnhandled: 'route-unhandled',
  /** У маршрута два обработчика: ответит тот, кто зарегистрировался позже. */
  routeDuplicated: 'route-duplicated',
  /** Обработчик слушает строку, которой нет в контракте. */
  routeUndeclared: 'route-undeclared',
} as const;

deepFreeze(FINDING_CODE);
