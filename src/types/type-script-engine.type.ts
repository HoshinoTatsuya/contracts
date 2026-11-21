import type ts from 'typescript';

import type { EngineProgram } from './engine-program.type';
import type { EngineSyntax } from './engine-syntax.type';
import type { TypeScriptCompiler } from './type-script-compiler.type';

/**
 * Установленный компилятор за адаптером: JS API TypeScript 5.9/6.x или
 * синхронный API TS 7 (процесс на Go). Выбирается по фактическому API пакета.
 */
export interface TypeScriptEngine {
  readonly compiler: TypeScriptCompiler;
  readonly syntax: EngineSyntax;
  /** Программа по корневым файлам: tsconfig проекта, `strict` всегда, умолчания модулей — NodeNext. */
  open(files: readonly string[], tsconfig: string | undefined): EngineProgram;
  /** Только разбор файлов, без разрешения импортов и проверки типов. */
  parse(files: readonly string[]): {
    sourceFile(file: string): ts.SourceFile | undefined;
    dispose(): void;
  };
}
