import { ContractDefinitionError } from '../errors/contract-definition.error';
import type { ContractRole } from '../types/contract-role.type';
import type { ContractSnapshot } from '../types/contract-snapshot.type';
import type { Shape } from '../types/shape.type';
import type { SnapshotSource } from '../types/snapshot-source.type';
import type { WireValue } from '../types/wire-value.type';
import { parseVersion } from '../version/parse-version';
import { createProgram } from './create-program';
import { shapeFromTypeScript } from './shape-from-type-script';
import { wireFromTypeScript } from './wire-from-type-script';

/**
 * Контракт, снятый с исходников TypeScript: интерфейс payload и словари
 * констант (очереди, ключи). Для стороны, которая держит контракт копией
 * интерфейса, а не через `defineContract`, — и для чтения ДРУГОЙ стороны с её
 * исходников (`exportTree` → `root`), пока та не публикует свой снимок.
 *
 * Версия на проводе по умолчанию не едет (`versionField: null`): интерфейс
 * её не несёт; если писатель кладёт её сам — указать поле.
 */
export function typeScriptContract(input: {
  readonly name: string;
  readonly version: string;
  /** Файл с интерфейсом/псевдонимом payload. */
  readonly file: string;
  readonly type: string;
  /** Словари значений на проводе: файл и имена `export const`/`enum`. */
  readonly wire?: { readonly file: string; readonly names: readonly string[] };
  readonly versionField?: string | null;
  readonly tsconfig?: string;
  /** Пакет компилятора вместо `typescript` (см. `createProgram`). */
  readonly compiler?: string;
  readonly examples?: readonly unknown[];
}): SnapshotSource {
  if (parseVersion(input.version) === null) {
    throw new ContractDefinitionError(
      input.name,
      '',
      `версия не разобрана: ${JSON.stringify(input.version)}`,
    );
  }
  const files = input.wire === undefined ? [input.file] : [input.file, input.wire.file];
  // Одна программа на форму и значения; у TS 7 это процесс компилятора — освобождается сразу после разбора.
  const program = createProgram(files, {
    ...(input.tsconfig === undefined ? {} : { tsconfig: input.tsconfig }),
    ...(input.compiler === undefined ? {} : { compiler: input.compiler }),
  });
  let shape: Shape;
  let wire: Record<string, WireValue>;
  try {
    shape = shapeFromTypeScript({ file: input.file, type: input.type, program });
    wire =
      input.wire === undefined
        ? {}
        : wireFromTypeScript({ file: input.wire.file, names: input.wire.names, program });
  } finally {
    program.dispose();
  }
  return {
    name: input.name,
    snapshot: (role: ContractRole): ContractSnapshot => ({
      role,
      version: input.version,
      versionField: input.versionField ?? null,
      // Сторона на типе TypeScript payload не проверяет: версию без поля не подставляет, лишних полей не отвергает.
      legacyVersion: null,
      extraFields: 'unchecked',
      shape,
      wire,
      examples: input.examples ?? [],
    }),
  };
}
