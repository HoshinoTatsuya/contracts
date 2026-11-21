# @hoshinotatsuya/contracts

[![npm](https://img.shields.io/npm/v/@hoshinotatsuya/contracts.svg)](https://www.npmjs.com/package/@hoshinotatsuya/contracts)
[![CI](https://github.com/HoshinoTatsuya/contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/HoshinoTatsuya/contracts/actions/workflows/ci.yml)

[English](README.md) · [Changelog](CHANGELOG.md)

Контракт между двумя репозиториями с **раздельной выкаткой** — очереди, ключи Redis, RPC-сообщения — обычно живёт копиями: у писателя своя, у читателя своя. Расхождение копий — не ошибка, а тишина:

| Что разошлось | Что происходит |
|---|---|
| писатель добавил поле, читатель его не объявил | поле молча выбрасывается — новая политика не применяется |
| читатель стал требовать поле, писатель его не шлёт | каждое сообщение отвергается — «задачи не разбираются» |
| ключ Redis или имя очереди под другим именем | ничего не читается, ошибки нет |
| набор строк на проводе расширен у писателя | читатель отвергает или сворачивает новое значение в «прочее» |
| одна сторона месяцами на старом образе | сверка с `main` зелёная, развёрнутое несовместимо |

Библиотека делает это исполняемым:

1. **Снимок** контракта — детерминированный JSON формы из Zod 4 (основной путь) или из типов TypeScript через компилятор; коммитится в репозиторий каждой стороны.
2. **Совместимость по направлению** (писатель → читатель) и отдельно **режим зеркала** (две копии обязаны совпасть).
3. **Сверка с версией ДРУГОЙ стороны**, а не со своим `main`: файл, git-ревизия, клон, развёрнутая ревизия по записи. Не добыли снимок — **отказ**, а не пропуск.
4. **Рантайм**: `defineContract` — версия в payload, терпимое чтение, отказ на чужом мажоре, хук на неизвестные поля.
5. **Гейт jest** и **CLI `contracts`** для джобы CI.

Сервисы-стороны контракта библиотека не знает и не называет: роли («пишет», «читает») задаёт каждая сторона в своём снимке.

## Установка

```sh
pnpm add @hoshinotatsuya/contracts zod
# по необходимости:
pnpm add -D typescript        # подпуть ./typescript — контракт с типов TypeScript
pnpm add -D @jest/globals     # подпуть ./jest под jest (со своими describe/it не нужен)
```

Все peer-зависимости необязательны — нужна та, которой пользуетесь:

| peer | для чего | диапазон |
|---|---|---|
| `zod` | `defineContract`, `shapeFromZod` | `>=4.0.0 <5` (и `zod/v4` из zod 3.25) |
| `typescript` | `@hoshinotatsuya/contracts/typescript` | 5.9, 6.0, 7.0, 7.1 beta |
| `@typescript/typescript6` | запасной компилятор, если `typescript` нет или форма его API незнакома | `^6.0.2` |
| `@jest/globals` | `contractsGate` без второго аргумента | `>=29` |

Node.js **24 и новее**. Пакет — CommonJS с декларациями, загружается и из ESM-проектов.

## Быстрый старт

**1. Контракт** (модуль одинаковый у обеих сторон, различаются роли):

```ts
// examples/contracts.ts
import { createSnapshot, defineContract } from '@hoshinotatsuya/contracts';
import { z } from 'zod';

export const SendEmail = defineContract({
  name: 'send-email',
  version: '1.3.0',
  schema: z.object({
    jobId: z.string(),
    to: z.array(z.string()),
    priority: z.enum(['low', 'high']),
    traceId: z.string().optional(),
  }),
  wire: {
    queue: 'email-jobs',
    lockKey: (jobId: string) => `email:lock:${jobId}`, // in the snapshot: `email:lock:${0}`
    lockMs: 20 * 60_000,
  },
  examples: [{ jobId: 'j-1', to: ['a@example.com'], priority: 'low' }],
});

export const EmailSent = defineContract({
  name: 'email-sent',
  version: '1.0.0',
  schema: z.object({ jobId: z.string(), deliveredAt: z.string() }),
  wire: { queue: 'email-results' },
});

// This side writes `send-email` and reads `email-sent`; the other side has the
// same two contracts with the roles swapped.
export const snapshot = () => createSnapshot({ writes: [SendEmail], reads: [EmailSent] });
```

**2. Рантайм** вместо payload, собранного руками:

```ts
// examples/runtime.ts
import { ContractPayloadError, ContractVersionError } from '@hoshinotatsuya/contracts';

import { SendEmail } from './contracts';

/** Any queue client: the contract does not depend on one. */
declare const queue: { add(name: string, data: unknown): Promise<unknown> };

export async function enqueue(jobId: string, to: string[]): Promise<void> {
  // write() validates, adds `contractVersion: '1.3.0'` and returns the JSON copy.
  await queue.add(SendEmail.wire.queue, SendEmail.write({ jobId, to, priority: 'high' }));
}

export function handle(payload: unknown): void {
  try {
    const { data, version, unknownFields } = SendEmail.read(payload);
    console.log(data.jobId, data.to.length, version, unknownFields);
  } catch (error) {
    if (error instanceof ContractVersionError) {
      // A writer on another major version: refuse loudly, do not guess.
    } else if (error instanceof ContractPayloadError) {
      // Missing required field or wrong type; `error.message` lists the paths.
    }
    throw error;
  }
}
```

**3. Снимок** — после сборки, из собранного модуля, и в коммит:

```sh
pnpm exec contracts snapshot --from dist/contracts.js --out contracts.snapshot.json --formatter biome
git add contracts.snapshot.json
```

**4. Сверка с другой стороной** в CI (второй репозиторий должен быть рядом клоном или по URL):

```sh
pnpm exec contracts verify --from dist/contracts.js --snapshot contracts.snapshot.json
pnpm exec contracts check --mine contracts.snapshot.json --peer git:../mailer#origin/HEAD:contracts.snapshot.json
```

Код `0` — совместимо, `1` — нарушения, `2` — НЕ ПРОВЕРЕНО, `3` — НЕ ДОКАЗАНО.

**5. Или то же спекой jest** — см. [Гейт jest](#гейт-jest).

Все блоки кода TypeScript в README — файлы из [`examples/`](examples): `pnpm run typecheck` проверяет их против исходников пакета, матрица потребителей компилирует их против собранного пакета и исполняет быстрый старт.

## Снимок

`createSnapshot({ writes, reads, both })` — роль это свойство **стороны**, а не контракта: копии одного контракта у двух сторон одинаковы, а роли противоположны. Документ (форма сокращена):

```json
{
  "contracts": {
    "send-email": {
      "examples": [{ "jobId": "j-1", "priority": "low", "to": ["a@example.com"] }],
      "extraFields": "refused",
      "legacyVersion": null,
      "role": "writer",
      "shape": { "kind": "object", "unknownKeys": "strip", "fields": { "priority": { "optional": false, "shape": { "kind": "enum", "values": ["high", "low"] } } } },
      "version": "1.3.0",
      "versionField": "contractVersion",
      "wire": { "lockKey": { "arity": 1, "type": "template", "value": "email:lock:${0}" }, "queue": { "type": "string", "value": "email-jobs" } }
    }
  },
  "format": "contracts-snapshot/2"
}
```

* **Форма описывает ВХОД на проводе JSON** — что писатель вправе положить и что читатель примет. `write()` кладёт на провод проверенный вход (не выход `transform`, без подставленных `default`) в том виде, в каком он уйдёт по JSON.
* **Обязательность поля — как у установленного zod на деле**: объект (без своих `refine`/`superRefine`) разбирается пустым, и поле без отклонения по своему пути необязательно. Поле, которое отсутствовать не может, но явное `undefined` принимает (`z.unknown()`, `z.any()`, `union([…, z.undefined()])` с zod 4.4), помечено `undefinedAccepted`: писатель вправе положить `undefined`, по JSON поле пропадёт, а читатель его требует — `field-may-be-missing`. Внутренние флаги zod (`optin`) и поведение меняются от минора к минору, поэтому снимок описывает поведение, а не флаг; апгрейд zod может изменить снимок — это изменение приёма, его видно в диффе. Снимок **исполняет** схему на пустом объекте и на объекте из `undefined`: побочные эффекты в `preprocess`/`transform`/`refine` при сборке снимка случатся; поле, на котором схема бросает, — обязательное; асинхронная схема — отказ; размеченное объединение, которое zod не может построить, — отказ.
* **Чего форма не выражает — `opaque`, а не «что угодно»**: `coerce`, `catch`, `preprocess`, `transform`, выход `pipe` после преобразования, кодеки (`stringbool`), `refine`/`superRefine`, проверка после `overwrite(fn)` и после `toLowerCase`/`toUpperCase`, свой формат с функцией, проверка с условием `when`, `xor` с пересекающимися вариантами, `looseRecord`, пересечение объектов с разными `catchall`. У узла две границы: `upper` — всё, что может быть принято (вне — отказ наверняка), `lower` — принятое наверняка. Сверка с таким читателем — см. «Не доказано».
* **Узел, меняющий только выход** (`default`/`prefault`, `trim`/`toLowerCase`/`toUpperCase` без проверок после них, `trim` с длиной после него), — `opaque` с `exact: true`: приём ровно как у `upper`, сверка точная, зеркало видит, что копии понимают значение по-разному. `semantics` описывает встроенное поведение целиком (значение по умолчанию, встроенная нормализация, `coerce` к типу с описанными проверками): одинаковая идиома у двух сторон даёт «совместимо», а не «не доказано». Текст `reason` в сравнение не входит.
* `z.json()` — любое значение JSON (`unknown`), а не отказ «рекурсивная схема».
* **Каноническая**: порядок полей, `'a' | 'b'` против `z.enum(['b', 'a'])`, `true | false` против `boolean`, перенос строки — одна и та же запись. Сравниваются разобранные формы, а не текст.
* **Строки на проводе** (`enum`, литералы, строковые TS-enum; у числового нативного enum — числа), необязательность, вложенность, массивы, кортежи, словари, объединения (в том числе размеченные), ограничения и политика неизвестных полей (`strip`/`reject`/`keep`) входят в форму. Несколько ограничений одного вида складываются (`min(3).nonempty()` — не меньше 3).
* **Шаблоны** — литералы с флагами (`/^a$/i`). **Форматы** — имя с параметрами и выражением, которым zod их проверяет (`uuid{"pattern":"/…/","version":"v4"}`); выражение пишется всегда, в том числе умолчание zod: у миноров оно разное. Формат, который zod проверяет ещё и функцией (`url`, `jwt`, `ipv6`, `cidrv6`, `base64`, `base64url`, `credit_card`, `iban`), несёт версию zod. Тот же формат с другим выражением или другой версией zod — «не доказано».
* **Длина строки** — с единицей: zod до 4.6 считает единицы UTF-16, с 4.6 — кодовые точки (`codePoints: true`); стороны на разных единицах сверяются пересчётом.
* `record` с конечным набором ключей (`z.enum`) — **объект**: zod 4 требует каждый ключ (кроме `partialRecord`) и отвергает чужие (кроме `looseRecord`).
* **JSON-транспорт учтён**: `Date` писателя едет строкой (год вне 0000–9999 — расширенный год, поэтому против `z.iso.datetime()` — «не доказано»), `z.date()` читателя строку отвергает (`json-lossy`), `bigint` JSON не переносит (`json-lossy`), `undefined` в массиве и кортеже едет как `null`, значение словаря `undefined` пропадает вместе с ключом; `exactOptional` на проводе равен `optional`.
* Чего нет на проводе (функция, Map, Set, symbol, промис, NaN) и рекурсия — **отказ** `ContractDefinitionError` с путём; вложенность глубже `CONTRACT_FORMAT.MAX_SHAPE_DEPTH` (256) — тоже отказ, а не переполнение стека.
* В записи снимка все поля обязательны: «нет значения» у `versionField` и `legacyVersion` — явный `null`, у `wire` — `{}`, у `examples` — `[]`.
* **Политика записи** — в снимке: `extraFields` (`refused` — `write()` отвергает поля вне формы, `kept` — `unknownFields: 'keep'` пропускает их, `unchecked` — контракт снят с типа TypeScript) и `legacyVersion` (читатель принимает payload без версии).
* Значения на проводе (`wire`): строки, числа, булевы, вложенные объекты (`keys.lock`), массивы (`list[0]`), построители ключей — функция вызывается с подстановками `${0}`, `${1}`, поэтому имя параметра на сравнение не влияет, а порядок — влияет.

**Закоммиченный снимок сравнивается по содержанию**: `biome format --write` по всему дереву не делает гейт красным навсегда. Запись идёт через форматтер репозитория (`writeSnapshot(file, doc, { formatter: 'biome' | 'prettier' | (file) => … })`, CLI `--formatter`); форматтер не найден, упал или изменил СОДЕРЖАНИЕ — отказ.

### С TypeScript, без `defineContract`

Для стороны, которая держит контракт копией интерфейса (подпуть `@hoshinotatsuya/contracts/typescript`, нужен `typescript` 5.9, 6.0, 7.0 или 7.1 beta):

```ts
// examples/typescript-contract.ts
import { createSnapshot } from '@hoshinotatsuya/contracts';
import { typeScriptContract } from '@hoshinotatsuya/contracts/typescript';

const SendEmail = typeScriptContract({
  name: 'send-email',
  version: '1.3.0',
  file: 'src/queue/send-email.interface.ts',
  type: 'SendEmailJob',
  wire: { file: 'src/queue/queues.constant.ts', names: ['QUEUES'] },
  tsconfig: 'tsconfig.json', // path aliases, moduleResolution
});

export const snapshot = () => createSnapshot({ reads: [SendEmail] });
```

* Форма — через **компилятор**: псевдонимы, `extends`, `Pick`/`Omit`, импорты, enum, шаблонные типы, брендированные примитивы раскрываются в то, что реально едет. Интерфейс и равнозначная Zod-схема дают одну форму (проверено спекой: зеркало зелёное).
* Тип описывает не то, что едет, — отказ или `opaque`, а не правдоподобная форма: аксессор — отказ; бесконечно раскрывающийся генерик — отказ на глубине 256; `object` — объект или массив с чем угодно; `{}` и `Object` — `opaque`; поле `unknown`/`any` — необязательное. Тип, который компилятор не разрешил (не найден модуль или имя — компилятор подставил бы `any`), — отказ с путём.
* Объявление ищется в файле и в его реэкспортах (`export { Dto } from './dto'`, `export * from './dto'`); два разных объявления одного имени (слияние интерфейсов) — отказ.
* Ключ-символ и приватное поле класса в снимок не попадают. Сторона на типе payload не проверяет: `extraFields: 'unchecked'`, `legacyVersion: null`.
* Значения — **вычисляются**: `20 * 60_000` и `1_200_000` — одно число, `` `${PREFIX}:tasks` `` с импортированным `PREFIX` — одна строка, `Object.freeze(…)`/`as const` снимаются, стрелочный построитель ключа — шаблон. Вызов функции, спред — отказ; цикл ссылок и вложенность глубже 32 — отказ; имя через `let`/`var` — отказ (может быть переприсвоено).
* `exportTree(repo, ref)` — дерево ревизии во временном каталоге (`git archive`), чтобы снять снимок ДРУГОЙ стороны с её исходников развёрнутой ревизии.
* `findWireLiterals({ root, values, include, declaredIn })` — строки на проводе, записанные литералом вместо обращения к контракту; вместе с числом просмотренных файлов (ноль находок на нуле файлов ничего не доказывает).

**Компилятор** выбирается по фактическому API установленного `typescript`:

| установлен | чем снимается | как |
|---|---|---|
| 5.9, 6.0 | JS API (`createProgram`) | в этом процессе |
| 7.0 | синхронный API компилятора на Go (`typescript/unstable/sync`) | процесс компилятора на программу |
| 7.1 beta | тот же API в новой раскладке (`typescript/sync`) | процесс компилятора на программу |
| `typescript` нет или форма API незнакома | запасной `@typescript/typescript6`, если установлен | в этом процессе |
| ничего не подошло | `TypeScriptCompilerError` с версией, каталогом пакета и перечнем недостающего | — |

Снимок один и тот же на 5.9, 6.0, 7.0 и 7.1: таблицы разбора пакета гоняются на каждой версии с ОДНОЙ таблицей ожиданий. Программу `createProgram` освобождать `dispose()` (у TypeScript 7 это процесс компилятора). Цена (Apple arm64, Node 24, фикстура из 3 файлов, медиана из 15):

| компилятор | первый вызов | повторный вызов | разбор на общей программе | память процесса Node |
|---|---|---|---|---|
| 5.9.3 | 555 мс | 290 мс | 0,2 мс | 555 МБ |
| 6.0.3 | 381 мс | 110 мс | 0,1 мс | 453 МБ |
| 7.0.2 | 106 мс | 46 мс | 2,2 мс | 72 МБ (+ процесс компилятора) |
| 7.1.0-beta | 151 мс | 34 мс | 4 мс | 78 МБ (+ процесс компилятора) |

## Совместимость

### По направлению: `compareShapes(writer, reader, { contract, mode, writerExtraFields? })`

Всё, что вправе послать писатель, читатель обязан принять и понять так же. Исходов три: **нарушение** (`violations`), **не доказано** (`unproven`) и совместимо; замечания (`notes`) вердикт не портят.

| Изменение | Меняется писатель (новый пишет → старый читает) | Меняется читатель (старый пишет → новый читает) | Зеркало |
|---|---|---|---|
| добавлено необязательное поле | ✓ (замечание `field-unread`) | ✓ (замечание `field-unsent`) | ✗ |
| добавлено обязательное поле | ✓ | ✗ `field-required-missing` | ✗ |
| удалено обязательное поле | ✗ `field-required-missing` | ✓ | ✗ |
| обязательное → необязательное | ✗ `field-may-be-missing` | ✓ | ✗ |
| необязательное → обязательное | ✓ | ✗ `field-may-be-missing` | ✗ |
| смена типа | ✗ `type-changed` | ✗ `type-changed` | ✗ |
| набор строк расширен | ✗ `wire-value-unknown` | ✓ | ✗ |
| набор строк сужен | ✓ | ✗ `wire-value-unknown` | ✗ |
| поле переименовано | ✗ (+ подсказка «похоже на переименование») | ✗ | ✗ |
| целое → дробное, добавлен диапазон/шаблон | ✗ / ✓ `constraint-narrowed` | ✓ / ✗ | ✗ |
| новое поле писателя при **строгом** читателе | ✗ `field-rejected` | — | ✗ |
| новый вариант размеченного объединения | ✗ `wire-value-unknown` по метке | ✓ | ✗ |
| у читателя появился `coerce`/`transform`/`refine`/`catch` | — | ? `not-proven` (✓, если писатель укладывается в принятое наверняка) | ? |
| писатель стал `unknownFields: 'keep'` или он тип TypeScript, читатель строгий | ✗ `open-to-strict` | — | ✗ (`extraFields`) |
| `Date`, `bigint`, `undefined` в массиве | ✗ `json-lossy` | ✗ `json-lossy` | ✗ `json-lossy` |

Полная таблица — `src/compare/compatibility-table.spec.ts`; ложно-зелёные пары, найденные дифференциальной сверкой с настоящим разбором zod, — `src/compare/semantic-losses.spec.ts`.

Режимы (`CompareMode`):

* `compatible` — стороны на разных версиях. Поле, которое писатель кладёт, а терпимый читатель не знает, и необязательное поле читателя, которого писатель не шлёт, — **замечания**: так и выглядит раздельная выкатка;
* `aligned` — стороны обязаны быть на одной версии, направление важно: читатель вправе быть мягче, не строже, и наборы полей обязаны совпасть;
* `mirror` — две копии одного контракта обязаны совпасть по форме целиком (`diffShapes`), плюс поле версии, `legacyVersion` и `extraFields`; непрозрачные узлы — `not-proven`, `Date`/`bigint`/`undefined` в массиве — `json-lossy` даже у совпавших копий.

### Не доказано

Сверка с читателем, чью семантику форма не выражает (`opaque`), даёт один из трёх ответов: писатель укладывается в принятое наверняка (`lower`) — **совместимо**; выходит за всё, что читатель может принять (`upper`), — **нарушение**; иначе — **`not-proven`**. Писатель шлёт числа ≥ 6, читатель `z.coerce.number().min(5)` — совместимо; писатель шлёт строку, читатель `z.coerce.number()` — не доказано (`'5'` пройдёт, `'abc'` — нет).

`not-proven` — **красное**: вердикт `ok: false`, у CLI код 3, у гейта своя проверка. Молчаливое «совместимо» про то, что снимок не видит, — ровно тот ложно-зелёный ответ, ради которого библиотека существует. Если совместимость доказана иначе (образцы, ревью функции), — запись в известных расхождениях с причиной; исчезнет `transform` — запись станет устаревшей.

Тоже `not-proven`: писатель, пропускающий поля вне формы (`extraFields: 'kept'`/`'unchecked'`), против читателя с типизированным `catchall` и против необязательного поля читателя, которого в форме писателя нет; зеркало одинаковых копий с непрозрачным узлом (узел с `semantics`, описанный целиком, — исключение).

**Объединение у читателя.** zod отдаёт **первый подошедший** вариант, а порядок вариантов снимок не хранит: если сообщение принимает и вариант, который выбросит поля писателя, в `aligned` это «не доказано», в `compatible` — замечание `field-unread`. Объект писателя сверяется с вариантом, выбранным по **меткам** — полям, у которых и у писателя, и у каждого варианта-объекта читателя ровно одна строка, по всем меткам сразу. Подошёл ровно один — сверка с ним; ни одного — `wire-value-unknown` или `union-option-unmatched`. **Кортежи** сверяются по длинам, которые вправе прислать писатель, и по позициям. Сверка глубже `CONTRACT_FORMAT.MAX_COMPARE_DEPTH` (256) — отказ `ShapeComparisonError`, а не переполнение стека и не «совместимо».

### Две стороны: `compareSnapshots(mine, peer, { mode, labels, only })`

Направление каждого контракта — из ролей сторон, политика записи — из снимка писателя. **Поле версии — часть payload**: форма писателя сверяется вместе с его полем версии. Нарушения: контракт только у одной стороны, роли без пары (обе только читают), разные мажоры (`major-mismatch`), поле версии писателя не то, что ищет читатель (`version-field-mismatch`; при `legacyVersion` у читателя — замечание), несовместимая форма, разошедшееся значение на проводе (`wire-constant-changed`), образец писателя, который читатель не примет (`example-rejected`). `only` с именем, которого нет ни у одной стороны, или пустой — отказ `ContractDefinitionError`.

### Изменение своей стороны: `checkEvolution(previous, next)`

Другая сторона ещё на прежней версии: пишешь — новая форма против прежнего читателя; читаешь — прежний писатель против новой формы, и снятый `legacyVersion` — нарушение. Плюс: форма, значения на проводе или политика изменились, а версия та же (`version-not-bumped`; `1.2` и `1.2.0` — одна версия); версия снизилась; контракт удалён; значение на проводе пропало. Поднят мажор — форма не сверяется, остаётся замечание.

### Известные расхождения: `applyKnown(verdict, known, minReasonLength = 30)`

`known` — словарь `'<контракт> <код> <путь>'` (см. `findingKey`) → причина не короче 30 символов. Запись адресует нарушение, `not-proven` или замечание — допущенная находка уходит из вердикта. Запись, которой не соответствует ни одна находка, — **устаревшая** (иначе пережила бы починку и прикрыла следующее расхождение по тому же адресу); с короткой причиной — **необъяснённая**. Итог: `{ verdict, stale, unexplained }`.

## Сверка с ДРУГОЙ стороной, а не с `main`

`loadPeerSnapshot(source, { timeoutMs = 120_000 })`:

| Источник (`PeerSource`) | Строка CLI | Что делает |
|---|---|---|
| `{ kind: 'file', path }` | `file:<путь>` или путь | каталог — `<каталог>/contracts.snapshot.json` |
| `{ kind: 'git', repo, ref, path }` | `git:<репозиторий>#<ref>:<путь>` | `git show <ref>:<путь>` — например, `origin/HEAD` на момент fetch, а не рабочее дерево |
| `{ kind: 'clone', url, ref, path }` | `clone:<url>#<ref>:<путь>` | `git fetch --depth 1 <url> <ref>` во временный каталог |
| `{ kind: 'deployed', record, repo }` | `deployed:<запись>@<репозиторий или url>` | ревизия из записи `recordDeployed`, снимок — из репозитория той стороны |

Любой отказ (нет файла, ревизии, клон не удался, формат чужой, снимок формата /1 до 0.2.0) — `PeerSnapshotUnavailableError`, у CLI — код **2 «НЕ ПРОВЕРЕНО»**. git вызывается без оболочки, без запроса пароля (`GIT_TERMINAL_PROMPT=0`, пустой `GIT_ASKPASS`, ssh — `BatchMode=yes`, если не задана своя `GIT_SSH_COMMAND`) и с потолком времени на ВСЮ добычу (`timeoutMs`): каждый вызов git получает остаток. Ревизия, адрес и путь, начинающиеся с `-`, — отказ до вызова git; позиционные аргументы отделены `--end-of-options`. Относительные пути — от рабочего каталога CLI, у гейта — от его `root`. `parsePeerSource(text)` и `describeSource(source)` переводят строку CLI в объект и обратно.

**Запись о развёрнутой ревизии** пишет конвейер выкатки (той стороны или своей):

```sh
contracts record-deployed --peer mailer --ref "$GITHUB_SHA" --snapshot-path contracts.snapshot.json --out contracts/mailer.deployed.json
```

Ревизия — только полный хэш (верхний регистр приводится к нижнему): ветка сдвигается и перестаёт означать «развёрнуто». Для fetch по хэшу сервер другой стороны должен его разрешать (`uploadpack.allowReachableSHA1InWant`/`allowAnySHA1InWant`; GitHub и GitLab по протоколу v2 отдают достижимые коммиты). Сервер, который не разрешает, — код 2; тогда источник `deployed:…@<локальный клон>` (fetch делает джоба, `git show` — библиотека). Проверено на локальном bare-репозитории (`file://`) и через `git daemon` на 127.0.0.1 (протокол v2, v0 с `allowReachableSHA1InWant` и без); на настоящих GitHub/GitLab не проверялось.

## Рантайм: `defineContract(definition)`

| опция | по умолчанию | смысл |
|---|---|---|
| `name` | — | имя контракта: ключ в снимке |
| `version` | — | `MAJOR.MINOR[.PATCH]`; мажор — граница отказа читателя |
| `schema` | — | схема Zod 4 формы payload (без поля версии) |
| `wire` | `{}` | значения на проводе: очереди, ключи Redis (строкой или построителем), маршруты, потолки |
| `versionField` | `'contractVersion'` | поле версии в payload; `null` — версия не едет |
| `unknownFields` | `'strip'` | неизвестные поля при чтении: `strip` — выбросить, `keep` — сохранить в результате |
| `legacyVersion` | — | версия для payload без поля версии; не задана — такой payload отвергается |
| `examples` | `[]` | образцы payload: проверяются схемой при объявлении и едут в снимок |
| `observer` | — | хуки `unknownFields`, `newerVersion`, `legacyPayload` |

У возвращённого `Contract` — `name`, `version`, `versionField`, `wire` (ваши значения с типами), `wireValues`, `shape`, `examples`, `snapshot(role)` и:

* `write(data)` — проверяет схемой и возвращает **проверенный вход в том виде, в каком он уйдёт по JSON** (копию после `JSON.stringify`/`JSON.parse`) плюс версию в `versionField`. Копия обязана пройти ту же схему: `Date` под `z.date()` и `bigint` — отказ, а не тихая порча. Поле, которого **форма контракта** не объявляет, писателю класть нельзя: именно так копии и расходятся (`unknownFields: 'keep'` это снимает — снимок помечает `extraFields: 'kept'`).
* `read(payload)` — **терпимое чтение**: неизвестные поля не роняют разбор (`strip` — выбрасываются, `keep` — сохраняются собственными полями результата; `__proto__` из payload остаётся полем и не становится прототипом); отсутствие обязательного и неверный тип — `ContractPayloadError` с путями (`to.0`); **чужой мажор** — `ContractVersionError('foreign-major')`; нет версии — отказ, если не задан `legacyVersion`. Итог: `{ data, version, unknownFields, omittedUnknownFields }`.
* Схема бросила исключение на payload (`JSON.parse` в `transform`, `new URL` в `refine`) — `ContractPayloadError` с исключением в `cause`; процесс не падает необработанным отклонённым Promise. Payload под `z.unknown()` любой глубины, которую переживает `JSON.parse`, разбирается без `RangeError`.
* `observer.unknownFields({ contract, version, paths, omitted })` — **тихая потеря становится видимой** (повесить метрику): индексы массивов свёрнуты (`items[].extra`), повторы убраны, путей не больше `CONTRACT_FORMAT.MAX_UNKNOWN_PATHS` (100). `newerVersion` — писатель на более новом миноре, `legacyPayload` — принят payload без версии. Упавший хук чтение не роняет — уходит `process.emitWarning`. Неизвестные поля в массивах сопоставляются по индексу: для схем, где `transform` сортирует или фильтрует массив, `unknownFields: 'keep'` не годится.
* Схема — Zod 4 (`zod`, `zod/mini`, `zod/v4` из 3.25); сам zod библиотека не импортирует (форма — из `_zod.def`, разбор — Standard Schema). Асинхронная схема — отказ.

## Гейт jest

```ts
// examples/contracts.spec.ts
import { join } from 'node:path';

import { contractsGate } from '@hoshinotatsuya/contracts/jest';

import { EmailSent, SendEmail, snapshot } from './contracts';

contractsGate({
  root: join(__dirname, '..'),
  snapshot,
  committed: 'contracts.snapshot.json',
  minContracts: 2,
  previous: { source: { kind: 'git', repo: '.', ref: 'origin/HEAD', path: 'contracts.snapshot.json' } },
  peers: [
    {
      name: 'mailer',
      source: { kind: 'deployed', record: 'contracts/mailer.deployed.json', repo: '../mailer' },
      known: {
        'send-email field-unread traceId': 'the mailer starts reading traceId in 1.4; until then it drops it',
      },
    },
  ],
  runtime: [SendEmail, EmailSent],
});
```

`ContractsGateOptions`: `root` (корень репозитория; от него — `committed` и относительные пути источников), `snapshot` (своя сторона из кода), `committed` (путь закоммиченного снимка), `minContracts` (не меньше 1), необязательные `title` (по умолчанию «контракты»), `formatter`, `previous`, `peers` (`name`, `source`, `mode` = `'compatible'`, `known`, `only`), `runtime` и `minReasonLength` (30).

Проверки: снимок совпадает с закоммиченным (`CONTRACTS_UPDATE=1` переписывает через форматтер; при заданном `CI`, не `false`/`0`, — отказ: переписанный снимок совпал бы сам с собой), выборка не выродилась, изменение против прежнего снимка, и по каждой стороне — снимок добыт (не добыт — красный), нарушений нет, «не доказано» нет (отдельная проверка), известные расхождения с причиной и ещё актуальны. Образцы писателей другой стороны разбираются НАСТОЯЩЕЙ схемой (`runtime`) — с `refine`/`transform`, которые снимок видит только как «не доказано»; поле версии к образцу подклеивает писатель — своё.

Сами проверки — `gateChecks(options)` (из корня пакета, без jest): `{ title, checks: [{ name, run }] }`, `run` бросает ошибку с причиной; `contractsGate` только регистрирует их как `it`. Для vitest, `node:test` и других раннеров — `contractsGate(options, { describe, it })` (`TestRegistrar`): `@jest/globals` тогда не загружается. Проверки синхронны, таймаут jest на них не действует.

Гейт, читающий второй репозиторий, — в **отдельной джобе**, которая этот репозиторий добывает: в наборе по умолчанию без второго репозитория он был бы красным всегда. Пропуска «если репозитория нет» нет намеренно: отсутствующая джоба видна в пайплайне, зелёная галочка за непроверенным — нет.

## CLI

```
contracts snapshot --from dist/contracts.js --out contracts.snapshot.json [--formatter biome|prettier|none]
contracts verify   --from dist/contracts.js --snapshot contracts.snapshot.json
contracts check    --mine contracts.snapshot.json --peer <источник> [--mode compatible|aligned|mirror] [--known known.json] [--only a,b] [--json]
contracts evolve   --previous git:.#origin/HEAD:contracts.snapshot.json --next contracts.snapshot.json [--known known.json]
contracts record-deployed --peer <имя> --ref <хэш> --snapshot-path <путь> --out <файл>
```

Коды выхода: **0** — совместимо/актуально; **1** — нарушения, устаревшие или необъяснённые известные расхождения; **2** — НЕ ПРОВЕРЕНО (снимок не добыт, неверные аргументы, опечатка или повтор флага, `--only` с контрактом, которого нет ни у одной стороны, или пустой); **3** — НЕ ДОКАЗАНО. `--from` — модуль с экспортом `snapshot` (или `default`): документ или функция, его возвращающая; ESM грузится средствами Node 24 (`require(esm)`), кроме модуля с top-level `await`. Флаги — `--ключ значение` или `--ключ=значение`. `--known` — JSON-файл `{ "<контракт> <код> <путь>": "причина" }`.

Джоба GitHub Actions:

```yaml
contract-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v5
    - uses: actions/checkout@v5
      with: { repository: your-org/mailer, path: ../mailer, fetch-depth: 50 }
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v5
      with: { node-version: 24, cache: pnpm }
    - run: pnpm install --frozen-lockfile && pnpm run build
    - run: pnpm exec contracts verify --from dist/contracts.js --snapshot contracts.snapshot.json
    - run: pnpm exec contracts check --mine contracts.snapshot.json --peer deployed:contracts/mailer.deployed.json@../mailer
```

## То же из кода

```ts
// examples/compare.ts
import {
  applyKnown,
  compareSnapshots,
  formatVerdict,
  loadPeerSnapshot,
  PeerSnapshotUnavailableError,
  type SnapshotDocument,
} from '@hoshinotatsuya/contracts';

import { snapshot } from './contracts';

export function checkAgainstPeer(): boolean {
  let peer: SnapshotDocument;
  try {
    peer = loadPeerSnapshot(
      { kind: 'git', repo: '../mailer', ref: 'origin/HEAD', path: 'contracts.snapshot.json' },
      { timeoutMs: 60_000 },
    );
  } catch (error) {
    if (error instanceof PeerSnapshotUnavailableError) {
      console.error(`NOT CHECKED: ${error.message}`); // a failure, never a skip
    }
    throw error;
  }
  const verdict = compareSnapshots(snapshot(), peer, { mode: 'compatible' });
  const known = applyKnown(verdict, {
    'send-email field-unread traceId': 'the mailer starts reading traceId in 1.4; until then it drops it',
  });
  console.log(formatVerdict(known.verdict));
  // A known difference that no longer matches anything is stale and fails the check too.
  return known.verdict.ok && known.stale.length === 0 && known.unexplained.length === 0;
}
```

## Справочник API

Корень `@hoshinotatsuya/contracts`:

| экспорт | что делает |
|---|---|
| `defineContract(definition)`, `Contract` | контракт рантайма: `write`, `read`, `snapshot(role)` |
| `createSnapshot({ writes, reads, both })` | снимок стороны; каждый источник проверяется и называется при отказе |
| `parseSnapshot(text, source)` | текст → документ с проверкой целиком; незнакомое — `SnapshotFormatError` |
| `serializeSnapshot(document)` | детерминированный текст JSON |
| `writeSnapshot(file, document, { formatter = 'none', cwd })` | запись через форматтер репозитория; нет, упал или изменил содержание — отказ |
| `snapshotsEqual(a, b)` | равенство по содержанию, а не по тексту |
| `compareShapes(writer, reader, { contract, mode, writerExtraFields, sameSource })` | сверка по направлению → `{ violations, unproven, notes }` |
| `diffShapes(left, right, { contract, labels })` | зеркало → находки |
| `compareWire(mine, peer, { contract, mode, labels })` | значения на проводе двух сторон |
| `compareSnapshots(mine, peer, { mode = 'compatible', labels, only })` | две стороны → `Verdict` |
| `checkEvolution(previous, next)` | изменение своей стороны → `Verdict` |
| `applyKnown(verdict, known, minReasonLength = 30)` | известные расхождения → `{ verdict, stale, unexplained }` |
| `findingKey(finding)` | адрес `'<контракт> <код> <путь>'` |
| `formatVerdict(verdict, title)` | вердикт текстом |
| `validateAgainstShape(value, shape)` | структурная проверка значения по форме |
| `canonicalShape(shape)` | каноническая форма |
| `shapeFromZod(schema, contract)` | форма схемы Zod 4 |
| `wireFromValues(wire, contract)` | значения на проводе по путям |
| `loadPeerSnapshot(source, { timeoutMs = 120_000 })` | снимок другой стороны |
| `parsePeerSource(text)`, `describeSource(source)` | строка CLI ↔ `PeerSource` |
| `recordDeployed(file, { peer, ref, snapshotPath })` | запись о развёрнутой ревизии |
| `exportTree(repo, ref)` | дерево ревизии во временном каталоге |
| `checkRoutes({ declared, handled, unhandled, foreign })` | у каждого маршрута ровно один обработчик, у каждого обработчика — маршрут; допущения с причиной, устаревшие — нарушение |
| `gateChecks(options)` | проверки гейта без jest |
| `CONTRACT_FORMAT` | замороженные константы: теги формата, имя файла снимка, `contractVersion`, `CONTRACTS_UPDATE`, потолки |
| `FINDING_CODE` | замороженный словарь кодов находок |
| ошибки | `ContractDefinitionError`, `ContractPayloadError`, `ContractVersionError`, `PeerSnapshotUnavailableError`, `ShapeComparisonError`, `SnapshotFormatError` |

`@hoshinotatsuya/contracts/typescript`: `typeScriptContract`, `shapeFromTypeScript`, `wireFromTypeScript`, `createProgram(files, { tsconfig, compiler } | путь tsconfig)` → `TypeScriptProgram` (`compiler`, `dispose()`), `findWireLiterals`, `TypeScriptCompilerError`. Опция `compiler` (например, `'typescript-7'`) — другой пакет компилятора, резолвится от рабочего каталога процесса.

`@hoshinotatsuya/contracts/jest`: `contractsGate(options, registrar?)`, `gateChecks`, типы `ContractsGateOptions`, `GateCheck`, `TestRegistrar`.

## Гарантии и ограничения

Гарантировано и покрыто спеками: детерминированный снимок (одни исходники — один документ на zod 4.1–4.6 и TypeScript 5.9/6.0/7.0/7.1 при одинаковом приёме); fail-closed везде — недобытый снимок, чужой формат, невыразимая форма, пустая выборка, неразобранное значение на проводе — отказ с причиной, а не пропуск и не «совместимо»; ни одного «совместимо» на парах из `src/compare/semantic-losses.spec.ts`.

Ограничения:

* рекурсивные схемы (`z.lazy` на себя, рекурсивные интерфейсы) — отказ; zod 3 (`_def.typeName`) — отказ, `zod/v4` из 3.25 работает;
* семантика функций (`refine`, `transform`, `preprocess`, `catch`, кодеки, функция формата) — только `opaque`: «не доказано» даже у одинаковых копий; доказывают образцы (гейт разбирает их настоящей схемой) и известные расхождения;
* форматы с функцией сверяются по версии zod, а не по поведению; список форматов «только выражением» — из zod 4.0–4.6;
* порядок вариантов объединения в снимок не входит: «какой вариант zod выберет первым» в `aligned` — «не доказано»;
* транспорт — JSON: структурное клонирование, MessagePack, superjson не моделируются (`json-lossy` для них — ложная тревога, допускайте её в известных расхождениях);
* **тексты по-русски**: сообщения ошибок, имена проверок гейта и вывод CLI — на русском; коды (`FINDING_CODE`, коды выхода, классы ошибок) стабильны и от языка не зависят;
* Windows: запуск форматтера через `cmd.exe` проверен моделью cmd.exe + MSVCRT на POSIX, а не на настоящем Windows (в CI нет Windows-раннера); пути виртуального tsconfig TypeScript 7 на Windows не проверены;
* TypeScript 7.2 и новее: API помечен нестабильным; незнакомая форма — отказ с перечнем недостающего (или запасной `@typescript/typescript6`);
* fetch развёрнутой ревизии по хэшу проверен на локальном bare-репозитории и `git daemon`, не на настоящих GitHub/GitLab.

Чего библиотека не заменяет (остаётся у проекта): привязку «схема входа обработчика — именно интерфейс клиента» у конкретного фреймворка; «объект контракта объявлен ровно в одном файле» по всему дереву; семантику (одинаковый алгоритм хэша на двух сторонах) и соотношения констант РАЗНЫХ контрактов (окно лока > потолка задачи).

## Поведение при отказе

| ситуация | API | CLI |
|---|---|---|
| форму не описать (функция, рекурсия, глубина, неразрешённый тип) | `ContractDefinitionError` | код 2 |
| документ снимка повреждён или другого формата | `SnapshotFormatError` | код 2 |
| снимок другой стороны не добыт (git, сеть, потолок времени, нет файла) | `PeerSnapshotUnavailableError` | код 2 «НЕ ПРОВЕРЕНО» |
| сверка глубже 256 уровней | `ShapeComparisonError` | код 2 |
| компилятора нет или API незнаком | `TypeScriptCompilerError` | код 2 |
| payload не подходит | `ContractPayloadError` (пути, `cause`) | — |
| чужой мажор / нет версии | `ContractVersionError` | — |
| нарушения / не доказано | `Verdict.ok === false` | код 1 / код 3 |

## Совместимость версий

* Node.js ≥ 24.
* zod ≥ 4.0 < 5 (проверено на 4.1.12, 4.3.6, 4.4.3, 4.6.5, 4.6.7 и `zod/v4` из 3.25).
* TypeScript 5.9, 6.0, 7.0, 7.1 beta для подпути `./typescript`; декларации пакета не ссылаются на типы `typescript` и проходят `skipLibCheck: false` на всех четырёх.
* Проекты потребителя: CJS, `node16`, `nodenext`, ESM с `nodenext` и `bundler`, `strict` + `exactOptionalPropertyTypes` (проверяет `pnpm run test:consumers`).
* jest ≥ 29 для `./jest` (проверено на 30.5.2); любой раннер — через `TestRegistrar`.
* git в `PATH` для источников `git`, `clone`, `deployed`.

### Тег формата снимка

Снимок несёт `"format": "contracts-snapshot/2"`, запись о развёрнутой ревизии — `"format": "contracts-deployed/1"`. Документы, записанные версиями до 0.4.0, несут тот же тег с префиксом пространства имён (`<scope>-contracts-snapshot/2`): формат тот же, они читаются. Читатель на версии до 0.4.0 тег без префикса не читает (чужой формат, код 2) — сначала обновите все стороны, которые читают снимки, потом пересобирайте снимки; см. [changelog](CHANGELOG.md).

## Миграция с самодельных гейтов

| Самодельная проверка | Чем заменяется |
|---|---|
| **гейт совпадения копий** (имена полей верхнего уровня интерфейса в двух репозиториях) | снимок каждой стороны + `contracts check --mode mirror` (или `aligned`): сверяются и типы, обязательность, вложенность, наборы строк — без ложных срабатываний «на записи» |
| **направленная сверка полей сообщения** (получатель мягче отправителя, не строже) | `compareShapes` в режиме `aligned`; роли сторон — в снимке |
| **гейт копий констант** (имена очередей, ключи Redis, потолки, шаблоны ключей, `20 * 60_000`) | `wire` контракта или `wireFromTypeScript`; переименование ключа — `wire-constant-changed` |
| **гейт замороженных строк на проводе** | строки входят в снимок; `checkEvolution` краснеет на удалении/переименовании строки, `version-not-bumped` — на изменении без версии |
| **золотые фикстуры провода** | `examples` контракта: проверяются формой читателя (CLI) и настоящей схемой читателя (гейт `runtime`) |
| **«репозитория второй стороны нет — отказ, а не пропуск»** | `PeerSnapshotUnavailableError`, CLI код 2, красная проверка гейта |
| **известные расхождения с причиной и проверкой «ещё есть»** | `known` гейта / `--known` CLI (`applyKnown`) |
| **«выборка не выродилась»** | `minContracts` гейта; CLI отказывает на пустом своём снимке и на `--only` без совпадений; `findWireLiterals` возвращает число просмотренных файлов |
| **«маршрут ↔ ровно один обработчик» с храповиком допущений** | `checkRoutes` |
| **«имена очередей только из пакета, не литералом»** | `findWireLiterals` по значениям `wire` |
| **сверка развёрнутой версии** — обычно не делается вовсе | `recordDeployed` + источник `deployed:` |

## Разработка и тесты

```sh
pnpm install
pnpm run typecheck        # src и examples/
pnpm run lint             # biome
pnpm test                 # сборка, затем jest последовательными группами не больше 300 тестов, 2 воркера
pnpm run test:consumers   # собранный пакет в одноразовых проектах CJS/ESM на typescript 5.9, 6.0, 7.0, 7.1 beta
pnpm run build
```

Набору нужен только git (сквозные спеки поднимают временные репозитории обеих сторон контракта, в том числе `git daemon` на 127.0.0.1). `pnpm test` идёт через `jest-groups`: полный набор никогда не поднимает воркер на каждое ядро; одну спеку — напрямую, `node_modules/.bin/jest --maxWorkers=2 <путь>`. `test:consumers` ставит собранный пакет и перечисленные версии typescript из реестра.

## Лицензия

[MIT](LICENSE) © 2026 Hoshino Tatsuya
