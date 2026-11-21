# @hoshinotatsuya/contracts

[![npm](https://img.shields.io/npm/v/@hoshinotatsuya/contracts.svg)](https://www.npmjs.com/package/@hoshinotatsuya/contracts)
[![CI](https://github.com/HoshinoTatsuya/contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/HoshinoTatsuya/contracts/actions/workflows/ci.yml)

[Русская версия](README.ru.md) · [Changelog](CHANGELOG.md)

Executable contracts between two repositories that are **deployed independently** — queue payloads,
Redis keys, RPC messages. Such a contract usually lives as two copies, one in the writer and one in the
reader, and when the copies drift apart nothing fails — things just go quiet:

| What drifted | What happens |
|---|---|
| the writer added a field the reader does not declare | the field is silently dropped, the new behaviour never applies |
| the reader now requires a field the writer does not send | every message is rejected — "jobs are not processed" |
| a Redis key or a queue name is spelled differently | nothing is read, and there is no error |
| the writer extended a set of wire strings | the reader rejects the new value or folds it into "other" |
| one side has been running an old image for months | the check against `main` is green, the deployed pair is incompatible |

This package makes that executable:

1. **Snapshot** of the contracts of one side — deterministic JSON of the payload shape, taken from a
   Zod 4 schema (main path) or from TypeScript types through the compiler; committed to each repository.
2. **Directional compatibility** (writer → reader) and, separately, a **mirror mode** (two copies must match).
3. **Comparison with the version of the OTHER side**, not with your own `main`: a file, a git revision,
   a fresh clone, or the revision that is actually deployed. If the other snapshot cannot be obtained,
   the check **fails** — it is never skipped.
4. **Runtime**: `defineContract` puts a version into the payload, reads tolerantly, refuses a foreign
   major version and reports unknown fields to a hook.
5. A **Jest gate** and a **`contracts` CLI** for the CI job.

The package knows nothing about your services: each side declares its own role (writes / reads) in its
snapshot.

## Install

```sh
pnpm add @hoshinotatsuya/contracts zod
# optional, only for the parts you use:
pnpm add -D typescript        # subpath ./typescript: contracts taken from TypeScript types
pnpm add -D @jest/globals     # subpath ./jest with Jest (not needed with your own describe/it)
```

All peer dependencies are optional; you need the one that matches what you use:

| peer | needed for | range |
|---|---|---|
| `zod` | `defineContract`, `shapeFromZod` | `>=4.0.0 <5` (also `zod/v4` from zod 3.25) |
| `typescript` | `@hoshinotatsuya/contracts/typescript` | 5.9, 6.0, 7.0, 7.1 beta |
| `@typescript/typescript6` | fallback compiler when `typescript` is missing or its API is unknown | `^6.0.2` |
| `@jest/globals` | `contractsGate` without a second argument | `>=29` |

Node.js **24 or newer** (`engines`). The package is CommonJS with type declarations; it loads from ESM
projects too.

## Quick start

Five steps from nothing to a red CI job when the two sides drift.

**1. Declare the contract** (the same module exists on both sides; only the roles differ):

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

**2. Use it at runtime** instead of hand-written payloads:

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

**3. Write and commit the snapshot** (after your build, from the compiled module):

```sh
pnpm exec contracts snapshot --from dist/contracts.js --out contracts.snapshot.json --formatter biome
git add contracts.snapshot.json
```

**4. Check against the other side** in CI. The other repository has to be present (a clone next to
yours, or a URL):

```sh
pnpm exec contracts verify --from dist/contracts.js --snapshot contracts.snapshot.json
pnpm exec contracts check --mine contracts.snapshot.json --peer git:../mailer#origin/HEAD:contracts.snapshot.json
```

Exit code `0` — compatible, `1` — violations, `2` — NOT CHECKED (the other snapshot could not be
obtained, bad arguments), `3` — NOT PROVEN (see [Not proven](#not-proven)).

**5. Or run the same checks as a Jest spec** (see [Jest gate](#jest-gate)).

All code blocks in this README are files from [`examples/`](examples); they are type-checked against
the package source by `pnpm run typecheck`, and the consumer matrix compiles them against the packed
package and runs the quick start.

## Snapshot

`createSnapshot({ writes, reads, both })` — the role belongs to the **side**, not to the contract: both
copies of a contract are the same, their roles are opposite. The document looks like this (the shape is
abbreviated):

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

What goes into the shape:

* **The shape describes the INPUT on the JSON wire** — what the writer may put and what the reader
  accepts. `write()` puts the validated input on the wire (not the output of `transform`, without
  filled-in `default`s) in the form it takes after JSON.
* **Whether a field is required is decided by the installed zod in practice**: the object is parsed
  empty and from `undefined` values, and a field without an issue on its own path is optional. A field
  that cannot be absent but accepts an explicit `undefined` (`z.unknown()`, `z.any()`,
  `union([…, z.undefined()])` since zod 4.4) is marked `undefinedAccepted`: the writer may put
  `undefined`, JSON drops it, and a reader that requires it gets `field-may-be-missing`. Because the
  schema is executed on an empty object, side effects inside `preprocess`/`transform`/`refine` happen
  while the snapshot is built; a field whose schema throws is required; an async schema is refused.
  Upgrading zod can change the snapshot — this is a change in what is accepted, and it shows in the diff.
* **What the shape cannot express is `opaque`, not "anything"**: `coerce`, `catch`, `preprocess`,
  `transform`, the output of `pipe` after a transformation, codecs (`stringbool`), `refine`/`superRefine`,
  checks after `overwrite(fn)` and after `toLowerCase`/`toUpperCase`, a custom format with a function,
  checks with a `when` condition, `xor` with overlapping options, `looseRecord`, intersections of objects
  with different `catchall`s. An opaque node carries two bounds: `upper` — everything that may be accepted
  (outside it is refused for sure) and `lower` — what is accepted for sure. Comparing against such a
  reader gives "not proven" — see below.
* **Nodes that only change the output** (`default`/`prefault`, `trim`/`toLowerCase`/`toUpperCase` without
  checks after them, `trim` with a length after it) are `opaque` with `exact: true`: acceptance is exactly
  `upper`, the comparison is exact, and the mirror sees that the copies interpret the value differently.
  `semantics` describes such built-in behaviour completely (default value, built-in normalisation,
  `coerce` to a type with described checks), so the same idiom on both sides is "compatible", not
  "not proven". The human-readable `reason` text is not compared.
* **Canonical**: field order, `'a' | 'b'` vs `z.enum(['b', 'a'])`, `true | false` vs `boolean`, line
  breaks — one and the same record. Parsed shapes are compared, not text.
* **Wire strings** (`enum`, literals, string TS enums; a numeric native enum is numbers), optionality,
  nesting, arrays, tuples, records, unions (including discriminated ones), constraints and the
  unknown-field policy (`strip`/`reject`/`keep`) are part of the shape. Several constraints of one kind
  combine (`min(3).nonempty()` — at least 3).
* **Patterns** are literals with flags (`/^a$/i`). **Formats** carry their parameters and the expression
  zod checks them with (`uuid{"pattern":"/…/","version":"v4"}`); the expression is always written, because
  zod minors differ. A format that zod also checks with a function (`url`, `jwt`, `ipv6`, `cidrv6`,
  `base64`, `base64url`, `credit_card`, `iban`) carries the zod version. The same format with another
  expression or another zod version is "not proven".
* **String length** carries its unit: zod before 4.6 counts UTF-16 units, 4.6+ counts code points
  (`codePoints: true`); sides on different units are compared by conversion.
* A `record` with a finite key set (`z.enum`) is an **object**: zod 4 requires every key (except
  `partialRecord`) and rejects others (except `looseRecord`).
* **The JSON transport is modelled**: a writer's `Date` travels as a string (a year outside 0000–9999 is
  an extended year, so against `z.iso.datetime()` it is "not proven"); a reader's `z.date()` rejects the
  string (`json-lossy`); `bigint` does not survive JSON (`json-lossy`); `undefined` in arrays and tuples
  becomes `null`; a record value `undefined` disappears with its key; `exactOptional` equals `optional`
  on the wire.
* What cannot travel (functions, Map, Set, symbol, promises, NaN) and recursion are **refused**
  (`ContractDefinitionError` with a path), never silently skipped; nesting deeper than
  `CONTRACT_FORMAT.MAX_SHAPE_DEPTH` (256) is refused too, not a stack overflow.
* Every field of a snapshot entry is required: "no value" is an explicit `null` for `versionField` and
  `legacyVersion`, `{}` for `wire`, `[]` for `examples`.
* **Write policy** is part of the snapshot: `extraFields` (`refused` — `write()` refuses fields outside
  the shape; `kept` — `unknownFields: 'keep'` lets them through; `unchecked` — taken from a TypeScript
  type, nothing refuses extra properties) and `legacyVersion` (the reader accepts payloads without a version).
* **Wire values** (`wire`): strings, numbers, booleans, nested objects (`keys.lock`), arrays (`list[0]`),
  key builders — the function is called with placeholders `${0}`, `${1}`, so parameter names do not
  matter but their order does.

**The committed snapshot is compared by content**, so running `biome format --write` (or prettier) over
the repository never makes the gate permanently red. Writing goes through the repository's formatter
(`writeSnapshot(file, doc, { formatter: 'biome' | 'prettier' | (file) => … })`, CLI `--formatter`); a
formatter that is missing, fails, or changes the CONTENT is a refusal.

### Contracts from TypeScript types

For a side that keeps the contract as an interface copy (subpath `@hoshinotatsuya/contracts/typescript`,
needs `typescript` 5.9, 6.0, 7.0 or 7.1 beta):

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

* The shape comes from the **compiler**: aliases, `extends`, `Pick`/`Omit`, imports, enums, template
  literal types and branded primitives resolve to what actually travels. An interface and an equivalent
  Zod schema give the same shape (checked by a spec: the mirror is green).
* A type that does not describe what travels is refused or `opaque`, never a plausible guess: accessors
  are refused; an endlessly expanding generic is refused at depth 256; `object` is "object or array of
  anything"; `{}` and `Object` are `opaque`; a `unknown`/`any` field is optional; a type the compiler
  could not resolve (missing module or name — the compiler would silently put `any`) is refused with a path.
* Declarations are found in the file and through its re-exports (`export { Dto } from './dto'`,
  `export * from './dto'`); two different declarations of one name (interface merging) are refused.
* Symbol keys and private class fields are not in the snapshot. A type-based side does not validate
  payloads: `extraFields: 'unchecked'`, `legacyVersion: null`.
* Wire values are **evaluated**: `20 * 60_000` and `1_200_000` are one number, `` `${PREFIX}:tasks` `` with
  an imported `PREFIX` is one string, `Object.freeze(…)`/`as const` are unwrapped, an arrow key builder is
  a template. Anything else (a function call, a spread) is refused; a reference cycle and nesting deeper
  than 32 are refused; names declared with `let`/`var` are refused (they can be reassigned).

**Compiler selection** is by the actual API of the installed `typescript`, not by its version number:

| installed | engine | where |
|---|---|---|
| 5.9, 6.0 | JS API (`createProgram`) | in this process |
| 7.0 | synchronous API of the Go compiler (`typescript/unstable/sync`) | one compiler process per program |
| 7.1 beta | the same API in the new layout (`typescript/sync`) | one compiler process per program |
| none, or an unknown API shape | fallback `@typescript/typescript6`, if installed | in this process |
| nothing fits | `TypeScriptCompilerError` with the version, package directory and the missing members | — |

The snapshot is the same on 5.9, 6.0, 7.0 and 7.1: every parsing table of the package runs on each
version against ONE table of expectations. A program built by `createProgram` must be released with
`dispose()` (on TypeScript 7 it is a compiler process). Cost measured on Apple arm64, Node 24, a
3-file fixture, median of 15:

| compiler | first call | repeated call | parse on a shared program | Node process memory |
|---|---|---|---|---|
| 5.9.3 | 555 ms | 290 ms | 0.2 ms | 555 MB |
| 6.0.3 | 381 ms | 110 ms | 0.1 ms | 453 MB |
| 7.0.2 | 106 ms | 46 ms | 2.2 ms | 72 MB (+ compiler process) |
| 7.1.0-beta | 151 ms | 34 ms | 4 ms | 78 MB (+ compiler process) |

## Compatibility rules

### Directional: `compareShapes(writer, reader, { contract, mode, writerExtraFields? })`

Everything the writer may send, the reader must accept and understand the same way. There are three
outcomes: **violation** (`violations`), **not proven** (`unproven`) and compatible; `notes` do not spoil
the verdict.

| Change | Writer changes (new writes → old reads) | Reader changes (old writes → new reads) | Mirror |
|---|---|---|---|
| optional field added | ✓ (note `field-unread`) | ✓ (note `field-unsent`) | ✗ |
| required field added | ✓ | ✗ `field-required-missing` | ✗ |
| required field removed | ✗ `field-required-missing` | ✓ | ✗ |
| required → optional | ✗ `field-may-be-missing` | ✓ | ✗ |
| optional → required | ✓ | ✗ `field-may-be-missing` | ✗ |
| type changed | ✗ `type-changed` | ✗ `type-changed` | ✗ |
| string set extended | ✗ `wire-value-unknown` | ✓ | ✗ |
| string set narrowed | ✓ | ✗ `wire-value-unknown` | ✗ |
| field renamed | ✗ (+ a "looks like a rename" hint) | ✗ | ✗ |
| integer → fractional, range/pattern added | ✗ / ✓ `constraint-narrowed` | ✓ / ✗ | ✗ |
| new writer field with a **strict** reader | ✗ `field-rejected` | — | ✗ |
| new option of a discriminated union | ✗ `wire-value-unknown` on the tag | ✓ | ✗ |
| the reader got `coerce`/`transform`/`refine`/`catch` | — | ? `not-proven` (✓ if the writer stays within what is accepted for sure) | ? |
| the writer became `unknownFields: 'keep'` or a TypeScript type, the reader is strict | ✗ `open-to-strict` | — | ✗ (`extraFields`) |
| `Date`, `bigint`, `undefined` in an array | ✗ `json-lossy` | ✗ `json-lossy` | ✗ `json-lossy` |

The full table is `src/compare/compatibility-table.spec.ts`; false-green pairs found by differential
testing against real zod parsing are in `src/compare/semantic-losses.spec.ts`.

Modes (`CompareMode`):

* `compatible` — the sides run different versions (independent rollout). A field the writer sends and a
  tolerant reader does not know, and an optional reader field the writer does not send, are **notes**.
* `aligned` — the sides must run the same version but the direction matters: the reader may be more
  lenient, not stricter, and the field sets must match (both cases above are violations).
* `mirror` — two copies of one contract must match completely (`diffShapes`), plus the version field,
  `legacyVersion` and `extraFields`; opaque nodes are `not-proven`, `Date`/`bigint`/`undefined` in an
  array are `json-lossy` even when the copies match.

### Not proven

Against a reader whose semantics the shape cannot express (`opaque`), there are three answers: the
writer stays within what the reader accepts for sure (`lower`) — **compatible**; the writer goes beyond
anything the reader can accept (`upper`) — **violation**; otherwise **`not-proven`**. Example: the writer
sends numbers ≥ 6 and the reader is `z.coerce.number().min(5)` — compatible; the writer sends a string and
the reader is `z.coerce.number()` — not proven (`'5'` passes, `'abc'` does not).

`not-proven` is **red**: the verdict has `ok: false`, the CLI exits with 3, the gate has its own check.
A silent "compatible" about something the snapshot cannot see is exactly the false green this package
exists to prevent. If compatibility is proven otherwise (examples, a review of the function), add a
known difference with a reason; when the `transform` disappears, the entry becomes stale.

Also `not-proven`: a writer that lets fields outside its shape through (`extraFields: 'kept'` /
`'unchecked'`) against a reader with a typed `catchall` or with an optional field the writer's shape does
not have; mirroring identical copies with an opaque node (one record is not one function — except nodes
with complete `semantics`).

**Unions on the reader side.** zod returns the **first matching** option, and the snapshot does not
store option order: if a message is also accepted by an option that drops writer fields, that is
"not proven" in `aligned` and a `field-unread` note in `compatible`. A writer object is matched to an
option by **tags** — fields that have exactly one string both in the writer and in every object option
of the reader, all tags at once. Exactly one option matches — compared with it; none — `wire-value-unknown`
or `union-option-unmatched`. **Tuples** are compared by the lengths the writer may send against the
lengths the reader accepts, and by position. A comparison deeper than `CONTRACT_FORMAT.MAX_COMPARE_DEPTH`
(256) is a `ShapeComparisonError`, not a stack overflow and not "compatible".

### Two sides: `compareSnapshots(mine, peer, { mode, labels, only })`

The direction of each contract comes from the roles of the sides, the write policy from the writer's
snapshot. **The version field is part of the payload**: the writer's shape is compared together with its
version field. Violations: a contract on one side only, roles without a pair (both only read), different
majors (`major-mismatch`), the writer's version field is not the one the reader looks for
(`version-field-mismatch`; a note if the reader has `legacyVersion`), an incompatible shape, a changed
wire value (`wire-constant-changed`), a writer example the reader would reject (`example-rejected`).
`only` with a name that neither side has, or an empty `only`, is a `ContractDefinitionError`:
"compatible" on an empty selection proves nothing.

### Changing your own side: `checkEvolution(previous, next)`

The other side still runs the previous version: if you write, the new shape (with the new write policy)
is checked against the previous reader; if you read, the previous writer is checked against the new shape,
and a removed `legacyVersion` is a violation. Also: shape, wire values or policy changed but the version
did not (`version-not-bumped`; versions are compared parsed — `1.2` equals `1.2.0`), the version
decreased, a contract was removed, a wire value disappeared. A major bump skips the shape check (the
incompatibility is declared, the reader will refuse loudly); a note remains.

### Known differences: `applyKnown(verdict, known, minReasonLength = 30)`

`known` maps `'<contract> <code> <path>'` (see `findingKey`) to a reason of at least 30 characters. An
entry may address a violation, a `not-proven` or a note; the matched finding leaves the verdict. An entry
that matches nothing is **stale** (otherwise it would outlive the fix and hide the next difference at the
same address); an entry with a too-short reason is **unexplained**. Returns
`{ verdict, stale, unexplained }`.

## Comparing with the OTHER side, not with `main`

`loadPeerSnapshot(source, { timeoutMs = 120_000 })`:

| Source (`PeerSource`) | CLI string | What it does |
|---|---|---|
| `{ kind: 'file', path }` | `file:<path>` or a path | a directory means `<dir>/contracts.snapshot.json` |
| `{ kind: 'git', repo, ref, path }` | `git:<repo>#<ref>:<path>` | `git show <ref>:<path>` — e.g. `origin/HEAD` as of the last fetch, not the working tree |
| `{ kind: 'clone', url, ref, path }` | `clone:<url>#<ref>:<path>` | `git fetch --depth 1 <url> <ref>` into a temporary directory |
| `{ kind: 'deployed', record, repo }` | `deployed:<record>@<repo or url>` | the revision from a `recordDeployed` record, the snapshot from that side's repository |

Any failure (no file, no revision, the clone failed, an unknown format, a snapshot of format `/1` from
before 0.2.0) is a `PeerSnapshotUnavailableError`, CLI exit code **2 "NOT CHECKED"**. git runs without a
shell and without password prompts (`GIT_TERMINAL_PROMPT=0`, empty `GIT_ASKPASS`, ssh `BatchMode=yes`
unless you set your own `GIT_SSH_COMMAND`), with a deadline for the WHOLE retrieval (`timeoutMs`): each
git call gets the remainder. A revision, URL or path starting with `-` is refused before git runs, and
positional arguments are separated with `--end-of-options`. Relative paths are resolved from the CLI's
working directory, and from `root` in the gate. `parsePeerSource(text)` and `describeSource(source)`
convert between the CLI string and the object.

**The deployed-revision record** is written by the deployment pipeline (of that side, or of yours):

```sh
contracts record-deployed --peer mailer --ref "$GITHUB_SHA" --snapshot-path contracts.snapshot.json --out contracts/mailer.deployed.json
```

The revision must be a full commit hash (upper case is lowered): a branch moves and stops meaning
"deployed". For a fetch by hash, the other side's server must allow it
(`uploadpack.allowReachableSHA1InWant`/`allowAnySHA1InWant`; GitHub and GitLab serve reachable commits over
protocol v2). A server that does not gives exit code 2 — then use `deployed:…@<local clone>` (the job
fetches, the package runs `git show`). Verified against a local bare repository (`file://`) and through
`git daemon` on 127.0.0.1 (protocol v2, and v0 with and without `allowReachableSHA1InWant`); not verified
against real GitHub/GitLab servers.

`exportTree(repo, ref)` — the tree of a revision in a temporary directory (`git archive`), to take the
snapshot of the other side from its sources of the deployed revision (`dir`, `dispose()`).

## Runtime: `defineContract(definition)`

Options (`ContractDefinition`):

| option | default | meaning |
|---|---|---|
| `name` | — | contract name: the key in the snapshot |
| `version` | — | `MAJOR.MINOR[.PATCH]`; the major is where the reader refuses |
| `schema` | — | Zod 4 schema of the payload (without the version field) |
| `wire` | `{}` | wire values: queue names, Redis keys (string or builder), routes, limits |
| `versionField` | `'contractVersion'` | payload field that carries the version; `null` — no version on the wire |
| `unknownFields` | `'strip'` | unknown fields on read: `strip` drops them, `keep` keeps them in the result |
| `legacyVersion` | — | version assumed for payloads without a version field; unset — such payloads are refused |
| `examples` | `[]` | sample payloads; validated at declaration and put into the snapshot |
| `observer` | — | hooks `unknownFields`, `newerVersion`, `legacyPayload` |

The returned `Contract` has `name`, `version`, `versionField`, `wire` (your values, typed), `wireValues`,
`shape`, `examples`, `snapshot(role)` and:

* `write(data)` — validates with the schema and returns the **validated input as it will travel over
  JSON** (a `JSON.stringify`/`JSON.parse` copy) plus the version in `versionField`. The copy must pass the
  same schema: `Date` under `z.date()` and `bigint` are refused, not silently corrupted. A field the
  **contract's shape** does not declare must not be written — that is how copies drift
  (`unknownFields: 'keep'` lifts this; the snapshot then says `extraFields: 'kept'`).
* `read(payload)` — **tolerant read**: unknown fields do not fail the parse (`strip` drops them, `keep`
  returns them as own fields of the result; a `__proto__` key stays a field and never becomes the
  prototype); a missing required field or a wrong type is a `ContractPayloadError` with paths
  (`to.0`); a **foreign major** is `ContractVersionError('foreign-major')`; no version is refused unless
  `legacyVersion` is set. Returns `{ data, version, unknownFields, omittedUnknownFields }`.
* A schema that throws on the payload (`JSON.parse` in `transform`, `new URL` in `refine`) gives a
  `ContractPayloadError` with the exception in `cause`; the process does not crash on an unhandled
  rejection. Payloads under `z.unknown()` of any depth `JSON.parse` survives are read without `RangeError`.
* `observer.unknownFields({ contract, version, paths, omitted })` makes silent loss visible (hang a
  metric on it): array indices are folded (`items[].extra`), duplicates removed, at most
  `CONTRACT_FORMAT.MAX_UNKNOWN_PATHS` (100) paths. `newerVersion` — the writer is on a newer minor;
  `legacyPayload` — a payload without a version was accepted. A throwing hook never fails the read — it
  becomes `process.emitWarning`. Unknown fields in arrays are matched by index: a `transform` that sorts or
  filters an array mixes them up, so `unknownFields: 'keep'` is not for such schemas.
* Schemas: Zod 4 (`zod`, `zod/mini`, `zod/v4` from 3.25). The package never imports zod itself (shape
  from `_zod.def`, parsing through Standard Schema). Async schemas are refused.

## Jest gate

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

`ContractsGateOptions`: `root` (repository root; `committed` and relative peer paths are resolved from
it), `snapshot` (your side, built from code), `committed` (path of the committed snapshot), `minContracts`
(lower bound, at least 1), optional `title` (default `'контракты'`), `formatter`, `previous`, `peers`
(`name`, `source`, `mode` = `'compatible'`, `known`, `only`), `runtime` and `minReasonLength` (30).

Checks: the snapshot matches the committed one (`CONTRACTS_UPDATE=1` rewrites it through the formatter;
with `CI` set and not `false`/`0` that is a refusal — a rewritten snapshot would match itself); the
selection did not degenerate; the change against the previous snapshot; and per peer — the snapshot was
obtained (otherwise red), no violations, no "not proven" (a separate check), known differences have a
reason and still match. Writer examples of the other side are parsed by the REAL schema (`runtime`) —
with the `refine`/`transform` the snapshot only sees as "not proven". The writer attaches its own version
field to the example.

`gateChecks(options)` (from the package root, no Jest) returns `{ title, checks: [{ name, run }] }`
where `run` throws with a reason; `contractsGate` only registers them as `it`. For vitest, `node:test`
and other runners pass `{ describe, it }` as the second argument (`TestRegistrar`) — `@jest/globals` is
then never loaded. The checks are synchronous, so the Jest timeout does not apply to them.

Put a gate that reads the second repository into a **separate CI job** that obtains that repository:
in the default test suite without it, the gate would be red forever. A "skip if the repository is
missing" is not offered on purpose: a missing job is visible in the pipeline, a green tick over an
unchecked comparison is not.

## CLI

```
contracts snapshot --from dist/contracts.js --out contracts.snapshot.json [--formatter biome|prettier|none]
contracts verify   --from dist/contracts.js --snapshot contracts.snapshot.json
contracts check    --mine contracts.snapshot.json --peer <source> [--mode compatible|aligned|mirror] [--known known.json] [--only a,b] [--json]
contracts evolve   --previous git:.#origin/HEAD:contracts.snapshot.json --next contracts.snapshot.json [--known known.json]
contracts record-deployed --peer <name> --ref <hash> --snapshot-path <path> --out <file>
```

Exit codes: **0** — compatible / up to date; **1** — violations, stale or unexplained known
differences; **2** — NOT CHECKED (snapshot not obtained, bad arguments, a typo or a repeated flag,
`--only` naming a contract neither side has, or empty); **3** — NOT PROVEN. `--from` is a module that
exports `snapshot` (or `default`): a document or a function returning one; ESM modules load through
Node 24's `require(esm)`, except modules with top-level `await`. Flags are `--key value` or `--key=value`.
`--known` is a JSON file `{ "<contract> <code> <path>": "reason" }`.

A GitHub Actions job:

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

## The same from code

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

## API reference

Root `@hoshinotatsuya/contracts`:

| export | what it does |
|---|---|
| `defineContract(definition)`, `Contract` | runtime contract: `write`, `read`, `snapshot(role)` (see [Runtime](#runtime-definecontractdefinition)) |
| `createSnapshot({ writes, reads, both })` | snapshot document of one side; every source is checked and named on failure |
| `parseSnapshot(text, source)` | text → document with full validation; `SnapshotFormatError` on anything unknown |
| `serializeSnapshot(document)` | deterministic JSON text |
| `writeSnapshot(file, document, { formatter = 'none', cwd })` | write and pass through the repository formatter; formatter missing, failing or changing the content — refusal |
| `snapshotsEqual(a, b)` | equality by content, not text |
| `compareShapes(writer, reader, { contract, mode, writerExtraFields, sameSource })` | directional comparison of two shapes → `{ violations, unproven, notes }` |
| `diffShapes(left, right, { contract, labels })` | mirror comparison → findings |
| `compareWire(mine, peer, { contract, mode, labels })` | wire values of two sides |
| `compareSnapshots(mine, peer, { mode = 'compatible', labels, only })` | two sides → `Verdict` |
| `checkEvolution(previous, next)` | change of your own side → `Verdict` |
| `applyKnown(verdict, known, minReasonLength = 30)` | known differences → `{ verdict, stale, unexplained }` |
| `findingKey(finding)` | stable address `'<contract> <code> <path>'` |
| `formatVerdict(verdict, title)` | verdict as text (violations, not proven, then notes) |
| `validateAgainstShape(value, shape)` | structural check of a value against a shape → issues |
| `canonicalShape(shape)` | canonical form of a shape |
| `shapeFromZod(schema, contract)` | shape of a Zod 4 schema |
| `wireFromValues(wire, contract)` | wire values by path (builders become templates) |
| `loadPeerSnapshot(source, { timeoutMs = 120_000 })` | snapshot of the other side (see above) |
| `parsePeerSource(text)`, `describeSource(source)` | CLI string ↔ `PeerSource` |
| `recordDeployed(file, { peer, ref, snapshotPath })` | write a deployed-revision record |
| `exportTree(repo, ref)` | revision tree in a temporary directory |
| `checkRoutes({ declared, handled, unhandled, foreign })` | each contract route has exactly one handler and each handler a route; exceptions need a reason, stale ones are violations |
| `gateChecks(options)` | the gate's checks without Jest |
| `CONTRACT_FORMAT` | frozen constants: format tags, snapshot file name, `contractVersion`, `CONTRACTS_UPDATE`, depth and path limits |
| `FINDING_CODE` | frozen dictionary of finding codes (`field-required-missing`, `not-proven`, …) |
| errors | `ContractDefinitionError`, `ContractPayloadError`, `ContractVersionError`, `PeerSnapshotUnavailableError`, `ShapeComparisonError`, `SnapshotFormatError` |

`@hoshinotatsuya/contracts/typescript`: `typeScriptContract`, `shapeFromTypeScript`, `wireFromTypeScript`,
`createProgram(files, { tsconfig, compiler } | tsconfigPath)` → `TypeScriptProgram` (`compiler`,
`dispose()`), `findWireLiterals({ root, values, include, declaredIn, compiler })` → `{ files, hits }` (wire
strings written as literals instead of via the contract; `files` is the number of files scanned — check it,
"zero hits" on zero files proves nothing), `TypeScriptCompilerError`. The `compiler` option (e.g.
`'typescript-7'`) takes another compiler package, resolved from the process working directory.

`@hoshinotatsuya/contracts/jest`: `contractsGate(options, registrar?)`, `gateChecks`, types
`ContractsGateOptions`, `GateCheck`, `TestRegistrar`.

## Guarantees and limits

Guaranteed and covered by specs:

* deterministic snapshots: the same sources give the same document on zod 4.1–4.6 and TypeScript
  5.9/6.0/7.0/7.1 for the same input (zod minors that change acceptance change the snapshot on purpose);
* fail-closed everywhere: an unobtainable peer snapshot, an unknown format, a shape that cannot be
  expressed, an empty selection, an unparseable wire value are refusals with a reason, never a skip or a
  green "compatible";
* no false "compatible" on the semantic-loss pairs in `src/compare/semantic-losses.spec.ts` (each is a
  payload the writer accepts and the reader rejects after JSON).

Limits:

* recursive schemas (`z.lazy` on itself, recursive interfaces) are refused; zod 3 (`_def.typeName`) is
  refused, `zod/v4` from 3.25 works;
* the semantics of functions (`refine`, `transform`, `preprocess`, `catch`, codecs, format functions) is
  only `opaque`: the answer is "not proven" even for identical copies; examples parsed by the real schema
  in the gate and known differences are how you prove it;
* formats with a check function are compared by zod version, not behaviour; the list of
  expression-only formats is from zod 4.0–4.6;
* union option order is not in the snapshot, so "which option zod picks first" is "not proven" in `aligned`;
* the transport is JSON: structured clone, MessagePack or superjson are not modelled (`json-lossy` is a
  false alarm there — accept it as a known difference);
* **messages are in Russian**: error texts, gate check names and CLI output are Russian; codes
  (`FINDING_CODE`, exit codes, error classes) are stable and language-independent;
* Windows: the formatter launch through `cmd.exe` is verified with a cmd.exe + MSVCRT model on POSIX, not
  on real Windows (no Windows runner in CI); TypeScript 7 virtual tsconfig paths on Windows are not verified;
* TypeScript 7.2 and newer: the API is marked unstable; an unknown shape is a refusal listing what is
  missing (or the `@typescript/typescript6` fallback);
* deployed-revision fetch by hash: verified with a local bare repository and `git daemon`, not against
  real GitHub/GitLab servers.

Not replaced by this package (stays in your project): binding "the handler's input schema is this
client's interface" in a specific framework; "the contract object is declared in exactly one file"
across the tree; semantics such as the same hash algorithm on both sides and relations between constants
of DIFFERENT contracts (lock window > task timeout).

## Failure behaviour

| situation | API | CLI |
|---|---|---|
| a shape cannot be described (function, recursion, too deep, unresolved type) | `ContractDefinitionError` | exit 2 |
| a snapshot document is malformed or of another format | `SnapshotFormatError` | exit 2 |
| the other side's snapshot cannot be obtained (git, network, timeout, missing file) | `PeerSnapshotUnavailableError` | exit 2 "NOT CHECKED" |
| comparison deeper than 256 levels | `ShapeComparisonError` | exit 2 |
| compiler missing or unknown API | `TypeScriptCompilerError` | exit 2 |
| payload does not match | `ContractPayloadError` (paths, `cause`) | — |
| foreign major / missing version | `ContractVersionError` | — |
| violations / not proven | `Verdict.ok === false` | exit 1 / exit 3 |

## Compatibility

* Node.js ≥ 24.
* zod ≥ 4.0 < 5 (checked on 4.1.12, 4.3.6, 4.4.3, 4.6.5, 4.6.7 and `zod/v4` from 3.25).
* TypeScript 5.9, 6.0, 7.0, 7.1 beta for the `./typescript` subpath; the package declarations do not
  reference `typescript` types and pass `skipLibCheck: false` on all four.
* Consumer projects: CJS, `node16`, `nodenext`, ESM with `nodenext` and `bundler`, `strict` +
  `exactOptionalPropertyTypes` (checked by `pnpm run test:consumers`).
* Jest ≥ 29 for `./jest` (checked with 30.5.2); any runner through `TestRegistrar`.
* git on `PATH` for the `git`, `clone` and `deployed` sources.

### Snapshot format tag

Snapshots carry `"format": "contracts-snapshot/2"`, deployed-revision records
`"format": "contracts-deployed/1"`. Documents written by releases before 0.4.0 carry the same tag with a
namespace prefix (`<scope>-contracts-snapshot/2`); they are the same format and are read as such. A reader
on a release before 0.4.0 does not read the unprefixed tag (it reports an unknown format, exit code 2), so
upgrade every side that reads snapshots before regenerating them — see the [changelog](CHANGELOG.md).

## Replacing hand-written gates

| Hand-written check | Replaced by |
|---|---|
| "the copies match" (top-level field names of an interface in two repositories) | a snapshot per side + `contracts check --mode mirror` (or `aligned`): types, optionality, nesting and string sets too, without formatting noise |
| directional field check of a message (receiver more lenient than sender) | `compareShapes` in `aligned` mode; roles come from the snapshot |
| copies of constants (queue names, Redis keys, limits, key templates, `20 * 60_000`) | the contract's `wire` or `wireFromTypeScript`; a renamed key is `wire-constant-changed` |
| frozen wire strings (route and enum lists) | strings are in the snapshot; `checkEvolution` fails on removal or rename, `version-not-bumped` on change without a version |
| golden wire fixtures | contract `examples`: checked by the reader's shape (CLI) and real schema (gate `runtime`) |
| "no second repository — fail, not skip" | `PeerSnapshotUnavailableError`, CLI exit 2, a red gate check |
| known differences with a reason and a "still there" check | gate `known` / CLI `--known` (`applyKnown`) |
| "the selection did not degenerate" | `minContracts`; the CLI refuses an empty own snapshot and `--only` without matches; `findWireLiterals` returns the number of files scanned |
| "route ↔ exactly one handler" with a ratchet of exceptions | `checkRoutes` |
| "queue names only from the package, never as literals" | `findWireLiterals` with the `wire` values |
| checking the deployed version — usually not done at all | `recordDeployed` + the `deployed:` source |

## Testing and development

```sh
pnpm install
pnpm run typecheck        # src and examples/
pnpm run lint             # biome
pnpm test                 # build, then Jest in sequential groups of at most 300 tests, 2 workers
pnpm run test:consumers   # packed package in throwaway CJS/ESM projects on typescript 5.9, 6.0, 7.0, 7.1 beta
pnpm run build
```

The test suite needs only git (end-to-end specs create throwaway repositories for both sides of a
contract, including a `git daemon` on 127.0.0.1). `pnpm test` runs through `jest-groups`, so the full suite
never starts one Jest worker per core; run a single spec directly with
`node_modules/.bin/jest --maxWorkers=2 <path>`. `test:consumers` installs the packed package and the
listed typescript versions from the registry.

## License

[MIT](LICENSE) © 2026 Hoshino Tatsuya
