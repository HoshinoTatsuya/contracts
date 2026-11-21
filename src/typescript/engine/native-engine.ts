import type { EngineSyntax } from '../../types/engine-syntax.type';
import type { Native } from '../../types/native.type';
import type { TypeScriptCompiler } from '../../types/type-script-compiler.type';
import type { TypeScriptEngine } from '../../types/type-script-engine.type';
import { nativeProgram } from './native-program';
import { SYNTAX_GUARDS } from './syntax-guards.constant';
import { TYPE_SCRIPT_API } from './type-script-api.constant';

/**
 * TypeScript 7: синхронный API к процессу компилятора на Go. Каждая программа
 * — свой процесс (освобождается `dispose`). Разбор без проверки типов — та же
 * программа без разрешения импортов и стандартной библиотеки.
 */
export function nativeEngine(modules: Native.Modules, compiler: TypeScriptCompiler): TypeScriptEngine {
  const renamed: Readonly<Record<string, string>> = TYPE_SCRIPT_API.nativeGuardNames;
  const syntax = Object.freeze({
    ...Object.fromEntries(SYNTAX_GUARDS.map((name) => [name, modules.is[renamed[name] ?? name]])),
    SyntaxKind: modules.ast.SyntaxKind,
    NodeFlags: modules.ast.NodeFlags,
  }) as unknown as EngineSyntax;
  return {
    compiler,
    syntax,
    open: (files, tsconfig) =>
      nativeProgram(modules, compiler, files, {
        tsconfig,
        defaults: { allowJs: false, target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext' },
        compilerOptions: { strict: true, strictNullChecks: true, noEmit: true, skipLibCheck: true },
      }),
    parse: (files) =>
      nativeProgram(modules, compiler, files, {
        tsconfig: undefined,
        defaults: undefined,
        compilerOptions: {
          noResolve: true,
          noLib: true,
          types: [],
          noEmit: true,
          skipLibCheck: true,
          allowJs: false,
        },
      }),
  };
}
