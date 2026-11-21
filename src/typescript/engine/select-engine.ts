import type ts from 'typescript';

import { TypeScriptCompilerError } from '../../errors/type-script-compiler.error';
import { describeThrown } from '../../runtime/describe-thrown';
import type { Native } from '../../types/native.type';
import type { TypeScriptEngine } from '../../types/type-script-engine.type';
import { classicEngine } from './classic-engine';
import { missingMembers } from './missing-members';
import { nativeEngine } from './native-engine';
import { SYNTAX_GUARDS } from './syntax-guards.constant';
import { TYPE_SCRIPT_API } from './type-script-api.constant';

/**
 * Движок по ФАКТИЧЕСКОМУ API установленного пакета, а не по номеру версии:
 * вход с `createProgram` — JS API 5.9/6.x; иначе — синхронный API TS 7 в
 * одной из известных раскладок (7.1: `typescript/sync`, 7.0:
 * `typescript/unstable/sync`). Найденный API сверяется по списку всего, чем
 * пользуется разбор; чего-то нет — отказ с именами недостающего. Незнакомая
 * форма — отказ, а не `TypeError` посреди разбора: API TS 7 помечен
 * нестабильным и меняется между минорами.
 */
export function selectEngine(
  name: string,
  load: (id: string) => unknown,
  installed: { readonly version: string; readonly directory: string },
): TypeScriptEngine {
  const label = `${name} ${installed.version} (${installed.directory})`;
  const refuse = (missing: readonly string[]): never => {
    throw new TypeScriptCompilerError(`${label}: форма API не узнана — нет ${missing.join(', ')}`);
  };
  const main = load(name);
  const classic = main as Record<string, unknown> | undefined;
  if (typeof classic?.createProgram === 'function') {
    const missing = [
      ...missingMembers(main, name, TYPE_SCRIPT_API.classic, 'present'),
      ...missingMembers(main, name, SYNTAX_GUARDS, 'function'),
      ...missingMembers(classic.TypeFlags, 'TypeFlags', TYPE_SCRIPT_API.typeFlags, 'number'),
      ...missingMembers(classic.SymbolFlags, 'SymbolFlags', TYPE_SCRIPT_API.symbolFlags, 'number'),
      ...missingMembers(classic.ElementFlags, 'ElementFlags', TYPE_SCRIPT_API.elementFlags, 'number'),
      ...missingMembers(classic.SyntaxKind, 'SyntaxKind', TYPE_SCRIPT_API.syntaxKinds, 'number'),
      ...missingMembers(classic.NodeFlags, 'NodeFlags', TYPE_SCRIPT_API.nodeFlags, 'number'),
    ];
    if (missing.length > 0) {
      refuse(missing);
    }
    return classicEngine(main as typeof ts, Object.freeze({ ...installed, api: 'classic' }));
  }
  const tried: string[] = [];
  for (const layout of TYPE_SCRIPT_API.nativeLayouts) {
    const entry = (path: string): string => `${name}${layout.prefix}/${path}`;
    let loaded: Omit<Native.Modules, 'dialect'>;
    try {
      loaded = {
        sync: load(entry('sync')) as Native.Sync,
        ast: load(entry('ast')) as Native.Modules['ast'],
        is: load(entry('ast/is')) as Native.Modules['is'],
        fs: layout.dialect === 'create-snapshot' ? (load(entry('fs')) as Native.Modules['fs']) : undefined,
      };
    } catch (error) {
      // Брошен может быть и null, и значение с бросающим геттером code: кода тогда нет — сломанный пакет.
      let code: unknown;
      try {
        code = (error as { code?: unknown }).code;
      } catch {
        code = undefined;
      }
      // Входа нет — это другая раскладка; любой другой отказ загрузки — не «не узнали», а сломанный пакет.
      if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || code === 'MODULE_NOT_FOUND') {
        tried.push(entry('sync'));
        continue;
      }
      throw new TypeScriptCompilerError(
        `${label}: вход ${entry('sync')} не загрузился: ${describeThrown(error)}`,
        {
          cause: error,
        },
      );
    }
    const sync = loaded.sync as unknown as Record<string, unknown>;
    const prototype = (key: string): unknown => (sync[key] as { prototype?: unknown } | undefined)?.prototype;
    const renamed: Readonly<Record<string, string>> = TYPE_SCRIPT_API.nativeGuardNames;
    const missing = [
      ...missingMembers(sync, entry('sync'), ['API', 'Checker', 'Program', 'NodeHandle'], 'function'),
      ...missingMembers(sync, entry('sync'), TYPE_SCRIPT_API.nativeFunctions, 'function'),
      ...missingMembers(sync, entry('sync'), TYPE_SCRIPT_API.nativeEnums, 'object'),
      ...missingMembers(prototype('API'), 'API', [layout.open, 'close'], 'present'),
      ...missingMembers(prototype('Checker'), 'Checker', TYPE_SCRIPT_API.nativeChecker, 'present'),
      ...missingMembers(prototype('Program'), 'Program', TYPE_SCRIPT_API.nativeProgram, 'present'),
      ...missingMembers(prototype('NodeHandle'), 'NodeHandle', TYPE_SCRIPT_API.nativeNodeHandle, 'present'),
      ...missingMembers(sync.TypeFlags, 'TypeFlags', TYPE_SCRIPT_API.typeFlags, 'number'),
      ...missingMembers(sync.SymbolFlags, 'SymbolFlags', TYPE_SCRIPT_API.symbolFlags, 'number'),
      ...missingMembers(sync.ElementFlags, 'ElementFlags', TYPE_SCRIPT_API.elementFlags, 'number'),
      ...missingMembers(sync.SignatureKind, 'SignatureKind', ['Call', 'Construct'], 'number'),
      ...missingMembers(loaded.ast.SyntaxKind, 'SyntaxKind', TYPE_SCRIPT_API.syntaxKinds, 'number'),
      ...missingMembers(loaded.ast.NodeFlags, 'NodeFlags', TYPE_SCRIPT_API.nodeFlags, 'number'),
      ...missingMembers(
        loaded.is,
        entry('ast/is'),
        SYNTAX_GUARDS.map((guard) => renamed[guard] ?? guard),
        'function',
      ),
      ...(layout.dialect === 'create-snapshot'
        ? missingMembers(loaded.fs, entry('fs'), ['createFileSystemLayer'], 'function')
        : []),
    ];
    if (missing.length > 0) {
      refuse(missing);
    }
    return nativeEngine(
      { ...loaded, dialect: layout.dialect },
      Object.freeze({ ...installed, api: 'native' }),
    );
  }
  return refuse([`createProgram (TypeScript 5.9/6.x)`, ...tried.map((path) => `${path} (TypeScript 7)`)]);
}
