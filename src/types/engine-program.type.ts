import type ts from 'typescript';

import type { EngineChecker } from './engine-checker.type';

/** Программа компилятора за адаптером: исходник по пути, проверка типов, освобождение. */
export interface EngineProgram {
  sourceFile(file: string): ts.SourceFile | undefined;
  readonly checker: EngineChecker;
  dispose(): void;
}
