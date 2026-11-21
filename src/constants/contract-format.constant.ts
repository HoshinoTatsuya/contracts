import { deepFreeze } from '../deep-freeze';

export const CONTRACT_FORMAT = {
  /**
   * Поле `format` снимка: другой формат — отказ разбора, а не «пустой снимок».
   * Формат /1 (до 0.2.0) не отличал `z.unknown()` от потерянной семантики
   * (`coerce`, `transform`…) и не нёс политику записи, поэтому не читается.
   * Снимки до 0.4.0 несут тег с префиксом пространства имён
   * (`<scope>-contracts-snapshot/2`) — это тот же формат, он читается.
   */
  SNAPSHOT: 'contracts-snapshot/2',
  /** Поле `format` записи о развёрнутой ревизии (прежний тег с префиксом тоже читается). */
  DEPLOYED: 'contracts-deployed/1',
  /** Имя файла снимка, когда источник — каталог. */
  SNAPSHOT_FILE: 'contracts.snapshot.json',
  /** Поле версии в payload по умолчанию. */
  VERSION_FIELD: 'contractVersion',
  /** Переменная окружения, по которой гейт переписывает закоммиченный снимок. */
  UPDATE_ENV: 'CONTRACTS_UPDATE',
  /**
   * Потолок вложенности сверки форм. Настоящая форма неглубока (десятки
   * уровней); глубже — петля в сверке или форма, которую не пишут руками, и
   * это отказ `ShapeComparisonError`, а не переполнение стека.
   */
  MAX_COMPARE_DEPTH: 256,
  /**
   * Потолок вложенности при снятии формы (схема Zod, тип TypeScript) и при
   * обходе payload рантаймом: допускается ровно столько уровней (корень —
   * первый). Глубже — отказ с путём
   * (`ContractDefinitionError` / `ContractPayloadError`), а не
   * `RangeError: Maximum call stack size exceeded`.
   */
  MAX_SHAPE_DEPTH: 256,
  /**
   * Потолок числа путей неизвестных полей в событии наблюдателя и в
   * `ReadResult.unknownFields`: индексы массивов сворачиваются в `[]`, повторы
   * убираются, остальное считается в `omittedUnknownFields`. Иначе 200 тысяч
   * элементов с лишним полем — 200 тысяч путей в метке метрики.
   */
  MAX_UNKNOWN_PATHS: 100,
} as const;

deepFreeze(CONTRACT_FORMAT);
