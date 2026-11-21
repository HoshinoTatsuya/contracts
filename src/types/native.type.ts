import type ts from 'typescript';

/**
 * Минимальная форма синхронного API TypeScript 7, которой пользуется адаптер.
 * Свои типы, а не декларации пакета: те — ESM для другой версии компилятора и
 * меняются между минорами (API помечен нестабильным). Узлы дерева — той же
 * формы, что у 5.9/6.x, поэтому описаны типами 5.9.
 */
export declare namespace Native {
  type Guard = (node: unknown) => boolean;
  type Table = Readonly<Record<string, number>>;

  interface Modules {
    readonly dialect: 'create-snapshot' | 'update-snapshot';
    readonly sync: Sync;
    readonly ast: { readonly SyntaxKind: Table; readonly NodeFlags: Table };
    readonly is: Readonly<Record<string, Guard>>;
    readonly fs:
      | { readonly createFileSystemLayer: (files: ReadonlyArray<readonly [string, string]>) => unknown }
      | undefined;
  }

  interface Sync {
    readonly API: new (options: ClientOptions) => Client;
    readonly TypeFlags: Table;
    readonly SymbolFlags: Table;
    readonly ElementFlags: Table;
    readonly SignatureKind: Table;
    readonly isErrorType: (type: Type) => boolean;
  }

  interface ClientOptions {
    readonly cwd: string;
    readonly fs?: {
      readonly readFile: (file: string) => string | undefined;
      readonly fileExists: (file: string) => boolean | undefined;
    };
  }

  interface Client {
    readonly updateSnapshot?: (params: { readonly openProjects: readonly string[] }) => Snapshot;
    readonly createSnapshot?: (params: {
      readonly openProjects: readonly string[];
      readonly fileSystem: unknown;
    }) => Snapshot;
    readonly close: () => void;
  }

  interface Snapshot {
    readonly getProject?: (config: string) => Project | undefined;
    readonly getConfiguredProject?: (config: string) => Project | undefined;
    readonly dispose: () => void;
  }

  interface Project {
    readonly program: Program;
    readonly checker: Checker;
  }

  interface Program {
    readonly getSourceFile: (file: string) => ts.SourceFile | undefined;
    readonly isSourceFileDefaultLibrary: (file: ts.SourceFile) => boolean;
    readonly getConfigFileParsingDiagnostics: () => readonly Diagnostic[];
  }

  interface Diagnostic {
    readonly code: number;
    readonly text?: string;
    readonly messageText?: string;
    readonly fileName?: string | null;
  }

  interface Checker {
    readonly getSymbolAtLocation: (node: ts.Node) => Symbol | undefined;
    readonly getAliasedSymbol: (symbol: Symbol) => Symbol;
    readonly getExportsOfModule: (symbol: Symbol) => readonly Symbol[];
    readonly getShorthandAssignmentValueSymbol: (node: ts.Node) => Symbol | undefined;
    readonly getConstantValue: (node: ts.Node) => string | number | undefined;
    readonly getTypeAtLocation: (node: ts.Node) => Type | undefined;
    readonly getTypeOfSymbolAtLocation: (symbol: Symbol, node: ts.Node) => Type;
    readonly typeToString: (type: Type) => string;
    readonly isArrayType: (type: Type) => boolean;
    readonly isTupleType: (type: Type) => boolean;
    readonly getTypeArguments: (type: Type) => readonly Type[];
    readonly getPropertiesOfType: (type: Type) => readonly Symbol[];
    readonly getIndexInfosOfType: (
      type: Type,
    ) => ReadonlyArray<{ readonly keyType: Type; readonly valueType: Type }>;
    readonly getSignaturesOfType: (type: Type, kind: number) => readonly unknown[];
    readonly getStringType: () => Type;
  }

  interface Type {
    readonly flags: number;
    readonly value?: unknown;
    readonly texts?: readonly string[];
    readonly elementFlags?: readonly number[];
    readonly getTypes: () => readonly Type[] | undefined;
    readonly getSymbol: () => Symbol | undefined;
    readonly getTarget: () => Type;
  }

  interface Symbol {
    readonly name: string;
    readonly escapedName: string;
    readonly flags: number;
    readonly declarations?: readonly Handle[];
    readonly valueDeclaration?: Handle;
  }

  interface Handle {
    readonly resolve: () => ts.Node | undefined;
  }
}
