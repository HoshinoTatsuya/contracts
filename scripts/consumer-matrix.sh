#!/usr/bin/env bash
# Матрица потребителей: собранный пакет (npm pack) ставится в одноразовые
# проекты с разными настройками модулей (CJS, node16, nodenext, ESM с
# nodenext и bundler) и разными версиями typescript (5.9, 6.0, 7.0 и 7.1 beta),
# везде strict + exactOptionalPropertyTypes + skipLibCheck: false (декларации
# пакета проверяются тем tsc, который у потребителя). В каждом: tsc по коду,
# который пользуется корнем, `./jest` и `./typescript` так, как написано в
# README (в том числе `runtime: [контракт]` гейта); загрузка входов в рантайме
# тем условием, которое выбирает проект (require или import); снимок с
# исходников TypeScript установленным компилятором (движок — по его API) против
# эталона; гейт jest настоящим jest (для CJS на 5.9: ts-jest не работает с
# TS 6+); собранный CLI `contracts` с модулем снимка `.cjs` и `.mjs`.
#
# Запуск: scripts/consumer-matrix.sh (pnpm run test:consumers) — только под
# общей блокировкой прогонов. Каталоги — из mkdtemp, удаляются в конце.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/contracts-consumers-XXXXXX")"
cleanup() {
  case "${WORK}" in
    "${TMPDIR:-/tmp}"/contracts-consumers-*) rm -rf "${WORK}" ;;
  esac
}
trap cleanup EXIT

(cd "${ROOT}" && pnpm run build >/dev/null && npm pack --silent --pack-destination "${WORK}" >/dev/null)
TARBALL="$(ls "${WORK}"/hoshinotatsuya-contracts-*.tgz)"

CONSUMER_TS="import {
  compareSnapshots,
  createSnapshot,
  defineContract,
  FINDING_CODE,
  gateChecks,
  type ExtraFieldsPolicy,
  type RuntimeReader,
  type Shape,
  type Verdict,
} from '@hoshinotatsuya/contracts';
import type { ContractsGateOptions } from '@hoshinotatsuya/contracts/jest';
import type { typeScriptContract } from '@hoshinotatsuya/contracts/typescript';
import { z } from 'zod';

// skipLibCheck прячет ошибки в декларациях пакета, а нерезолвящийся импорт в них
// молча становится any. Утверждение ниже не компилируется, если экспорт стал any.
type IsAny<T> = 0 extends 1 & T ? true : false;
type NotAny<T> = IsAny<T> extends true ? never : true;
export const typed: [
  NotAny<typeof defineContract>, NotAny<typeof gateChecks>, NotAny<typeof typeScriptContract>,
  NotAny<Verdict>, NotAny<Shape>, NotAny<ContractsGateOptions>, NotAny<RuntimeReader>,
] = [true, true, true, true, true, true, true];

export const ScanTask = defineContract({
  name: 'scan-task',
  version: '1.3.0',
  schema: z.object({ taskId: z.string(), hosts: z.array(z.string()), trace: z.string().optional() }),
  wire: { queue: 'scan-tasks', lockKey: (taskId: string) => \`scan:lock:\${taskId}\` },
  examples: [{ taskId: 't-1', hosts: ['a.example'] }],
});
export const payload = ScanTask.write({ taskId: 't', hosts: [] });
export const queue: string = ScanTask.wire.queue;
export const policy: ExtraFieldsPolicy = 'refused';
export const snapshot = () => createSnapshot({ writes: [ScanTask] });
export const verdict: Verdict = compareSnapshots(snapshot(), snapshot(), { mode: 'mirror' });
export const code: string = FINDING_CODE.notProven;
// Как в README: свой контракт с конкретной схемой — в runtime гейта.
export const gate: ContractsGateOptions = {
  root: '.',
  snapshot,
  committed: 'contracts.snapshot.json',
  minContracts: 1,
  runtime: [ScanTask],
};
export const checks: number = gateChecks(gate).checks.length;
"

SPEC_TS="import { contractsGate } from '@hoshinotatsuya/contracts/jest';
import { checks, payload, verdict } from './consumer';

it('корень пакета работает у потребителя', () => {
  expect([checks, payload.contractVersion, verdict.ok]).toEqual([2, '1.3.0', true]);
});

// Гейт из пакета регистрирует свои it в спеке потребителя.
contractsGate({
  root: __dirname,
  snapshot: () => ({ format: 'contracts-snapshot/2', contracts: {} }),
  committed: 'absent.json',
  minContracts: 1,
  title: 'гейт у потребителя',
});
"

DTO_TS="import type { Proto } from './proto.js';
export enum Kind { Scan = 'scan', Probe = 'probe' }
export interface Dto { proto: Proto; port?: number; kind: Kind; pair: [string, number?]; key: \`lock:\${string}\` }
export const QUEUES = { scan: 'scan-tasks', lock: (id: string) => \`lock:\${id}\` } as const;
"
PROTO_TS="export type Proto = 'http' | 'https';
"
# Снимок с исходников и вид движка — одинаковые у всех версий typescript, кроме вида движка.
TS_SNAPSHOT='{"role":"writer","version":"1.0.0","versionField":null,"legacyVersion":null,"extraFields":"unchecked","shape":{"kind":"object","fields":{"key":{"optional":false,"shape":{"kind":"template","pattern":"^lock:[\\s\\S]{0,}$"}},"kind":{"optional":false,"shape":{"kind":"enum","values":["probe","scan"]}},"pair":{"optional":false,"shape":{"kind":"tuple","items":[{"kind":"string"},{"kind":"union","options":[{"kind":"number"},{"kind":"undefined"}]}]}},"port":{"optional":true,"shape":{"kind":"number"}},"proto":{"optional":false,"shape":{"kind":"enum","values":["http","https"]}}},"unknownKeys":"strip"},"wire":{"QUEUES.scan":{"type":"string","value":"scan-tasks"},"QUEUES.lock":{"type":"template","arity":1,"value":"lock:${0}"}},"examples":[]}'
TS_RUN="const source = t.typeScriptContract({ name: 'dto', version: '1.0.0', file: 'src/dto.ts', type: 'Dto', wire: { file: 'src/dto.ts', names: ['QUEUES'] } });
const program = t.createProgram(['src/dto.ts']);
program.dispose();
process.stdout.write(program.compiler.api + ' ' + JSON.stringify(source.snapshot('writer')));"

SNAP_CJS="const { createSnapshot, defineContract } = require('@hoshinotatsuya/contracts');
const { z } = require('zod');
exports.snapshot = () =>
  createSnapshot({ writes: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({ id: z.string() }) })] });
"
SNAP_MJS="import { createSnapshot, defineContract } from '@hoshinotatsuya/contracts';
import { z } from 'zod';
export const snapshot = () =>
  createSnapshot({ writes: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({ id: z.string() }) })] });
"

failures=0
fail() {
  echo "$1"
  failures=$((failures + 1))
}
run_case() {
  local label="$1" module="$2" resolution="$3" type="$4" jest="$5" typescript="$6"
  local dir="${WORK}/${label}"
  mkdir -p "${dir}/src"
  # ts-jest (и с ним jest для .ts) — только там, где он работает: typescript 5.9.
  local jest_deps=""
  if [[ "${jest}" == "jest" ]]; then
    jest_deps='"jest": "30.5.2", "ts-jest": "29.4.5",'
  fi
  cat >"${dir}/package.json" <<JSON
{
  "name": "consumer-${label}",
  "private": true,
  "type": "${type}",
  "dependencies": {
    "@hoshinotatsuya/contracts": "file:${TARBALL}",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@jest/globals": "30.5.2",
    "@types/jest": "30.0.0",
    "@types/node": "24.0.15",
    ${jest_deps}
    "typescript": "${typescript}"
  }
}
JSON
  local resolution_line=""
  if [[ -n "${resolution}" ]]; then
    resolution_line="\"moduleResolution\": \"${resolution}\","
  fi
  cat >"${dir}/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "module": "${module}",
    ${resolution_line}
    "target": "ES2024",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": false,
    "types": ["jest", "node"],
    "noEmit": true
  },
  "include": ["src"]
}
JSON
  printf '%s' "${CONSUMER_TS}" >"${dir}/src/consumer.ts"
  printf '%s' "${DTO_TS}" >"${dir}/src/dto.ts"
  printf '%s' "${PROTO_TS}" >"${dir}/src/proto.ts"
  # ESM с nodenext требует расширение в относительном импорте.
  if [[ "${type}" == "module" && "${resolution}" == "nodenext" ]]; then
    printf '%s' "${SPEC_TS}" | sed "s#'./consumer'#'./consumer.js'#" >"${dir}/src/consumer.spec.ts"
  else
    printf '%s' "${SPEC_TS}" >"${dir}/src/consumer.spec.ts"
  fi
  cat >"${dir}/jest.config.js" <<'JS'
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  maxWorkers: 2,
};
JS
  if [[ "${type}" == "module" ]]; then
    mv "${dir}/jest.config.js" "${dir}/jest.config.cjs"
  fi
  # jest 30.5+ тянет @parcel/watcher с install-скриптом; pnpm 11+ без решения отказывает в установке.
  cat >"${dir}/pnpm-workspace.yaml" <<'YAML'
packages:
  - '.'
allowBuilds:
  '@parcel/watcher': false
YAML
  (cd "${dir}" && pnpm install --prefer-offline --silent >"${dir}/install.log" 2>&1) || {
    fail "${label}: установка не прошла"; tail -5 "${dir}/install.log"; return
  }
  # skipLibCheck: false — декларации пакета проверяет tsc потребителя. Ошибки ЧУЖИХ деклараций (@types/node 24.0
  # под TS 6+, zod под 7.1 beta) — не про пакет: красное — только ошибки в декларациях пакета и в коде потребителя.
  local status=0
  (cd "${dir}" && node_modules/.bin/tsc -p tsconfig.json >"${dir}/tsc.log" 2>&1) || status=$?
  local ours foreign
  ours="$(grep -E 'error TS[0-9]+' "${dir}/tsc.log" | grep -E '(@hoshinotatsuya/contracts/|(^|/)src/[a-z.-]+\.ts\()' || true)"
  foreign="$(grep -cE 'error TS[0-9]+' "${dir}/tsc.log" || true)"
  if [[ "${status}" -ne 0 && "${status}" -ne 1 && "${status}" -ne 2 ]]; then
    fail "${label}: tsc не отработал (код ${status})"; head -8 "${dir}/tsc.log"
  elif [[ -n "${ours}" ]]; then
    fail "${label}: tsc — КРАСНЫЙ в декларациях пакета или коде потребителя"; printf '%s\n' "${ours}" | head -8
  elif [[ "${status}" -ne 0 && "${foreign}" -eq 0 ]]; then
    fail "${label}: tsc — код ${status} без разобранных ошибок"; head -8 "${dir}/tsc.log"
  else
    echo "${label}: tsc (skipLibCheck: false) — пакет и код зелёные; ошибок чужих деклараций: ${foreign}"
  fi
  # Примеры README (examples/*.ts) — против собранного пакета: в проектах CJS tsc с выводом, затем
  # быстрый старт исполняется (снимок, write → read). ESM с nodenext требует расширений в импортах — там не гоняются.
  if [[ "${type}" == "commonjs" ]]; then
    mkdir -p "${dir}/examples"
    cp "${ROOT}"/examples/*.ts "${dir}/examples/"
    cat >"${dir}/tsconfig.examples.json" <<'JSON'
{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": false, "outDir": "out-examples", "rootDir": "examples" }, "include": ["examples"] }
JSON
    local examples_status=0 examples_ours
    (cd "${dir}" && node_modules/.bin/tsc -p tsconfig.examples.json >"${dir}/tsc-examples.log" 2>&1) || examples_status=$?
    examples_ours="$(grep -E 'error TS[0-9]+' "${dir}/tsc-examples.log" | grep -E '(@hoshinotatsuya/contracts/|(^|/)examples/[a-z.-]+\.ts\()' || true)"
    if [[ -n "${examples_ours}" || ! -f "${dir}/out-examples/contracts.js" ]]; then
      fail "${label}: примеры README — tsc КРАСНЫЙ (код ${examples_status})"; printf '%s\n' "${examples_ours}" | head -8
    elif (cd "${dir}" && node -e "
      const assert = require('node:assert/strict');
      const ex = require('./out-examples/contracts.js');
      const doc = ex.snapshot();
      assert.deepEqual(Object.keys(doc.contracts).sort(), ['email-sent', 'send-email']);
      assert.equal(doc.contracts['send-email'].role, 'writer');
      assert.equal(doc.contracts['email-sent'].role, 'reader');
      assert.deepEqual(doc.contracts['send-email'].wire.lockKey, { type: 'template', arity: 1, value: 'email:lock:\${0}' });
      const payload = ex.SendEmail.write({ jobId: 'j-2', to: ['b@example.com'], priority: 'high' });
      assert.equal(payload.contractVersion, '1.3.0');
      const read = ex.SendEmail.read({ ...payload, extra: 1 });
      assert.deepEqual([read.data.jobId, read.version, read.unknownFields], ['j-2', '1.3.0', ['extra']]);
    " >"${dir}/examples.log" 2>&1); then
      echo "${label}: примеры README — компилируются и исполняются"
    else
      fail "${label}: примеры README — исполнение КРАСНОЕ"; tail -8 "${dir}/examples.log"
    fi
  fi
  # Рантайм того же условия, которое выбирают декларации: import для ESM-проекта, require — для CJS.
  local check='typeof c.defineContract === "function" && typeof c.gateChecks === "function" && Object.isFrozen(c.FINDING_CODE) && typeof t.typeScriptContract === "function"'
  local runtime="const c = require('@hoshinotatsuya/contracts'); const t = require('@hoshinotatsuya/contracts/typescript'); if (!(${check})) process.exit(1);"
  local input=commonjs
  if [[ "${type}" == "module" ]]; then
    runtime="const c = await import('@hoshinotatsuya/contracts'); const t = await import('@hoshinotatsuya/contracts/typescript'); if (!(${check})) process.exit(1);"
    input=module
  fi
  if (cd "${dir}" && node --input-type="${input}" -e "${runtime}" >"${dir}/runtime.log" 2>&1); then
    echo "${label}: рантайм входов — зелёный"
  else
    fail "${label}: рантайм входов — КРАСНЫЙ"; head -5 "${dir}/runtime.log"
  fi
  # Снимок с исходников установленным typescript: движок по API пакета (7.x — native), снимок — как у эталона.
  local api=classic
  if [[ "${typescript}" == 7.* ]]; then
    api=native
  fi
  local ts_load="const t = require('@hoshinotatsuya/contracts/typescript');"
  if [[ "${type}" == "module" ]]; then
    ts_load="const t = await import('@hoshinotatsuya/contracts/typescript');"
  fi
  (cd "${dir}" && node --input-type="${input}" -e "${ts_load} ${TS_RUN}" >"${dir}/typescript.out" 2>"${dir}/typescript.log") || true
  # Сравнение разобранного JSON, а не строки: порядок ключей снимка — не часть контракта.
  if node -e "
    const [api, ...rest] = require('node:fs').readFileSync(process.argv[1], 'utf8').split(' ');
    const same = api === process.argv[2] && require('node:util').isDeepStrictEqual(JSON.parse(rest.join(' ')), JSON.parse(process.argv[3]));
    process.exit(same ? 0 : 1);
  " "${dir}/typescript.out" "${api}" "${TS_SNAPSHOT}" 2>/dev/null; then
    echo "${label}: снимок с исходников (${api}) — как эталон"
  else
    fail "${label}: снимок с исходников — НЕ ТАК: $(head -c 400 "${dir}/typescript.out")"; head -5 "${dir}/typescript.log"
  fi
  if [[ "${jest}" == "jest" ]]; then
    (cd "${dir}" && node_modules/.bin/jest --maxWorkers=2 --json --outputFile=jest.json >"${dir}/jest.log" 2>&1) || true
    # Ожидание: тест корня зелёный, гейт зарегистрировал 2 проверки, «снимок совпадает» красная (файла нет).
    local summary
    summary="$(node -e "const r=require('${dir}/jest.json'); const a=r.testResults.flatMap((s)=>s.assertionResults); console.log(a.map((x)=>x.status+' '+x.title).join('|'))" 2>/dev/null || echo 'нет отчёта')"
    local expected='passed корень пакета работает у потребителя|failed снимок совпадает с закоммиченным (absent.json)|failed выборка не выродилась: контрактов не меньше 1'
    if [[ "${summary}" == "${expected}" ]]; then
      echo "${label}: ts-jest и гейт — как ожидалось"
    else
      fail "${label}: ts-jest и гейт — НЕ ТАК: ${summary}"; grep -E 'TS[0-9]+|Cannot' "${dir}/jest.log" | head -5
    fi
  fi
  # Собранный CLI: модуль снимка .cjs и .mjs, затем verify.
  printf '%s' "${SNAP_CJS}" >"${dir}/snap.cjs"
  printf '%s' "${SNAP_MJS}" >"${dir}/snap.mjs"
  local kind
  for kind in cjs mjs; do
    if (cd "${dir}" && node_modules/.bin/contracts snapshot --from "snap.${kind}" --out "snap-${kind}.json" >"${dir}/cli-${kind}.log" 2>&1 \
      && node_modules/.bin/contracts verify --from "snap.${kind}" --snapshot "snap-${kind}.json" >>"${dir}/cli-${kind}.log" 2>&1); then
      echo "${label}: CLI с модулем .${kind} — зелёный"
    else
      fail "${label}: CLI с модулем .${kind} — КРАСНЫЙ"; tail -3 "${dir}/cli-${kind}.log"
    fi
  done
}

# typescript 5.9 — все раскладки модулей и гейт настоящим jest.
run_case commonjs commonjs "" commonjs jest 5.9.3
run_case node16 node16 node16 commonjs jest 5.9.3
run_case nodenext nodenext nodenext commonjs jest 5.9.3
run_case bundler-esm esnext bundler module tsc-only 5.9.3
run_case nodenext-esm nodenext nodenext module tsc-only 5.9.3
# typescript 6.0, 7.0 (latest) и 7.1 beta — CJS и ESM: декларации их tsc, рантайм и снимок их компилятором.
for typescript in 6.0.3 7.0.2 7.1.0-beta; do
  run_case "nodenext-ts${typescript}" nodenext nodenext commonjs tsc-only "${typescript}"
  run_case "nodenext-esm-ts${typescript}" nodenext nodenext module tsc-only "${typescript}"
  run_case "bundler-esm-ts${typescript}" esnext bundler module tsc-only "${typescript}"
done

if [[ "${failures}" -gt 0 ]]; then
  echo "матрица потребителей: красных ${failures}"
  exit 1
fi
echo "матрица потребителей: все зелёные"
