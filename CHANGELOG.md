# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the package uses
[Semantic Versioning](https://semver.org/) with the pre-1.0 rule that a breaking change bumps the minor.

## [0.4.0] — 2026-11-21

> Minor version: the wire tag of snapshot and deployed-revision documents changed (see Migration). Before 1.0 a breaking change bumps the minor version.

First public release as `@hoshinotatsuya/contracts`, MIT; documentation in English and Russian.
Comparison, snapshot contents and the runtime are unchanged; the one behavior change is the wire tag
(see Migration).

### Changed

- The format tags no longer carry a namespace prefix: snapshots are written with
  `"format": "contracts-snapshot/2"`, deployed-revision records with `"format": "contracts-deployed/1"`.
  Documents with the previous prefixed tag of the same generation (`<scope>-contracts-snapshot/2`,
  `<scope>-contracts-deployed/1`) are still read; the committed snapshot of a side is compared per
  contract, so it is not reported as stale after the upgrade.
- Temporary tsconfig files of the TypeScript 7 engine are named `.contracts-<uuid>.*`.
- README examples live in `examples/`, are type-checked by `pnpm run typecheck` and compiled and run
  against the packed package by the consumer matrix.
- CI runs on GitHub Actions; dev dependencies: arch-gates 0.12.2, jest-groups 0.7.2.

### Migration

- A reader on 0.3.2 or older does not read the unprefixed tags (unknown format, CLI exit code 2). Upgrade
  every side that reads the other side's snapshot or deployed-revision record to 0.4.0 first; regenerate
  snapshots (`CONTRACTS_UPDATE=1` / `contracts snapshot`) and write new records after that. Until a
  snapshot is regenerated it keeps the old tag, which both old and new releases read.

## [0.3.2] — 2026-11-21

### Fixed

- Failure texts no longer throw on a value without a prototype or with a throwing `toString` /
  `Symbol.toPrimitive` / `message` getter: the observer hook, schema exceptions and issue paths,
  `toJSON` of a payload, `snapshot()` of a source, key builders, the gate's example reader and peer
  retrieval, the CLI, and loading TypeScript 7 used to replace the original cause with a `TypeError`.
- `ContractVersionError` with a `BigInt` version and `validateAgainstShape` on a cyclic value or a
  throwing `toJSON` produce an issue with a text instead of a serialisation exception.

## [0.3.1] — 2026-11-17

### Fixed

- Windows: the snapshot formatter (`biome.cmd` / `prettier.cmd`) was started with `shell: true` and an
  argument array — `DEP0190` on Node 24 and a future failure. The command line for
  `cmd.exe /d /s /c` is now built by the package (MSVCRT quoting plus `^` before cmd.exe metacharacters,
  twice); paths with `%`, `!`, `^`, `&`, spaces and quotes reach the formatter literally, a line break is a
  `ContractDefinitionError`. Verified with a cmd.exe + MSVCRT model, not on real Windows.
- TypeScript 7 under Jest 30.5+: Jest replaced `process.getBuiltinModule` in its sandbox, and the
  `./typescript` subpath failed with `Must use import to load ES Module` (or silently fell back to the
  6.x engine). `require` is now taken from the host realm.

### Changed

- Dev stack: Jest and `@jest/globals` 30.5.2.

## [0.3.0] — 2026-11-17

### Added

- TypeScript 7 support in `./typescript` (the Go compiler; before 0.3.0 the subpath failed with a
  `TypeError` and its declarations with `TS2694`). The engine is chosen by the actual API of the installed
  `typescript`: 5.9/6.0 — JS API; 7.0 and 7.1 beta — the synchronous compiler API; otherwise the optional
  `@typescript/typescript6` fallback, else `TypeScriptCompilerError` listing what is missing.
- The snapshot of the same sources is identical on 5.9, 6.0, 7.0 and 7.1; the consumer matrix covers all four.
- peer `typescript`: `>=5.9.0 <7.2.0 || >=7.1.0-beta <7.2.0`; optional peer `@typescript/typescript6`.

### Changed

- `typescript` is loaded on first use, not on import of the subpath.

### Migration

1. `createProgram` returns `TypeScriptProgram` (`compiler`, `dispose()`), not `ts.Program`; its second
   argument is `{ tsconfig, compiler }` (a string is still a tsconfig path).
2. Release programs with `program.dispose()` (on TypeScript 7 it is a compiler process); a closed program
   is a `TypeScriptCompilerError`.
3. `program` in `shapeFromTypeScript` / `wireFromTypeScript` must come from this package's `createProgram`.
4. "No `typescript`" / "unknown API" is a `TypeScriptCompilerError` at call time, not an import error.

## [0.2.0] — 2026-11-16

Breaking: snapshot format `/2`, a third comparison outcome "not proven", the write policy in the
snapshot. Found by differential testing of the verdict against real zod parsing
(`src/compare/semantic-losses.spec.ts`): every pair there was "compatible" before 0.2.0.

### Added

- `not-proven` instead of "anything": `coerce`, `preprocess`, `catch`, `transform`, `pipe` outputs,
  `stringbool`, `refine` and checks after normalisation are `opaque` nodes with `upper`/`lower` bounds.
- Write policy in the snapshot: `extraFields` (`refused` / `kept` / `unchecked`) and `legacyVersion`.
- Precise formats and patterns (regex flags, format parameters and expressions, zod version for formats
  with a function), string length units (zod 4.6 counts code points), `int`/`float32` bounds.
- JSON transport: `Date`, `bigint`, `undefined` in arrays are `json-lossy`.
- `gateChecks` (root and `./jest`), `RuntimeReader`, a gate check for "not proven", `ZodLike` export.

### Fixed

- Records with enum keys, `partialRecord`, `looseRecord`; `aligned` with a declared-open writer; numeric
  native enums; intersections with different `catchall`s; literal tags in unions; tuples by lengths and
  positions; first-match union semantics in `aligned`.
- `constructor`, `toString`, `__proto__` are ordinary fields; `read()` with `keep` no longer makes a sent
  `__proto__` the prototype of the result.
- A schema throwing on a payload crashed the process with an unhandled rejection; it is now a
  `ContractPayloadError` with `cause`.
- git: revisions, URLs and paths starting with `-` are refused, `--end-of-options`, ssh `BatchMode=yes`,
  one deadline for the whole retrieval.
- TypeScript: accessors refused, unresolved types refused (they used to become `any`), endless generics
  refused instead of `RangeError`, `object` / `{}` / `Object` described honestly.
- CLI: `--only` without matches or empty is exit code 2 (was 0), a repeated flag is exit code 2,
  "not proven" is exit code 3.

### Migration

1. Regenerate the snapshot of every side: format `/1` is not read, and the other side's old snapshot
   gives exit code 2 until that side is released with 0.2.0.
2. `Verdict` / `CompareOutcome` have a new `unproven` field, `ok` is false with it; `toVerdict` takes three
   arguments.
3. CLI: handle exit code 3; `--only` with existing names only.
4. For each `not-proven` finding either remove the cause (an exact schema instead of `transform`, the
   writer's type instead of `coerce`) or add a known difference with a reason.
5. Unknown-field paths are folded (`items[].x`), plus `omittedUnknownFields` / `omitted`.
6. `ContractSnapshot` has new required fields `legacyVersion` and `extraFields`; shapes carry pattern
   literals, format parameters, `codePoints`, `undefinedAccepted`, `exact`, `semantics`.
7. `write()` returns the JSON copy of the payload; payloads that do not survive JSON under their own schema
   are refused; fields outside the shape are detected in class instances and `toJSON` too.
8. A schema throwing on a payload is `ContractPayloadError` (was `ContractDefinitionError`).
9. Gate: `CONTRACTS_UPDATE=1` with `CI` set is a refusal; regenerate snapshots locally.

## [0.1.1] — 2026-11-16

### Fixed

- `compareShapes`, object vs union: the tag was the alphabetically first single-string field even when
  it was the same in every option — false violations from another option. Options are now chosen by all
  tags at once.
- `compareShapes`, string set vs union (`enum | null`): infinite recursion and `RangeError`.
- Comparison depth guard `CONTRACT_FORMAT.MAX_COMPARE_DEPTH` (256) and `ShapeComparisonError`.

### Migration

Nothing required. Known differences added for the false union violations become stale; remove them.

## [0.1.0] — 2026-11-15

First version: snapshots (Zod 4, TypeScript), directional compatibility and mirror, comparison with the
other side (file, git, clone, deployed revision), evolution of one's own side, the `defineContract`
runtime, the Jest gate, the `contracts` CLI, `checkRoutes`, `findWireLiterals`.

[0.4.0]: https://github.com/HoshinoTatsuya/contracts/releases/tag/v0.4.0
