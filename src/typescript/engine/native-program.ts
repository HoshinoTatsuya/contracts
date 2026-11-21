import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

import { ContractDefinitionError } from '../../errors/contract-definition.error';
import { TypeScriptCompilerError } from '../../errors/type-script-compiler.error';
import { describeThrown } from '../../runtime/describe-thrown';
import type { EngineProgram } from '../../types/engine-program.type';
import type { Native } from '../../types/native.type';
import type { TypeScriptCompiler } from '../../types/type-script-compiler.type';
import { missingMembers } from './missing-members';
import { nativeChecker } from './native-checker';
import { TYPE_SCRIPT_API } from './type-script-api.constant';

/**
 * Программа TypeScript 7: процесс компилятора и проект из ВИРТУАЛЬНОГО
 * tsconfig, которого нет на диске (его отдаёт слой файловой системы 7.1 или
 * обратный вызов чтения 7.0). Виртуальный tsconfig наследует `[умолчания,
 * tsconfig проекта]` — значение проекта побеждает умолчание, как у 5.9/6.x —
 * и задаёт обязательные опции и ровно переданные корневые файлы. Лежит рядом с
 * tsconfig проекта (или в текущем каталоге): от его каталога ищутся `@types`,
 * как у 5.9/6.x.
 *
 * tsconfig проекта, который не читается (нет файла, синтаксис), — отказ с
 * текстом компилятора, как у 5.9/6.x; ошибки опций — нет (5.9/6.x их тоже
 * не роняют).
 */
export function nativeProgram(
  modules: Native.Modules,
  compiler: TypeScriptCompiler,
  files: readonly string[],
  config: {
    readonly tsconfig: string | undefined;
    readonly defaults: Readonly<Record<string, unknown>> | undefined;
    readonly compilerOptions: Readonly<Record<string, unknown>>;
  },
): EngineProgram {
  const tsconfig = config.tsconfig === undefined ? undefined : resolve(config.tsconfig);
  const base = join(tsconfig === undefined ? process.cwd() : dirname(tsconfig), `.contracts-${randomUUID()}`);
  const virtual = `${base}.tsconfig.json`;
  const defaults = `${base}.defaults.json`;
  const parents = [
    ...(config.defaults === undefined ? [] : [defaults]),
    ...(tsconfig === undefined ? [] : [tsconfig]),
  ];
  const texts = new Map<string, string>([
    [
      virtual,
      JSON.stringify({
        ...(parents.length === 0 ? {} : { extends: parents }),
        compilerOptions: config.compilerOptions,
        files: files.map((file) => resolve(file)),
        include: [],
      }),
    ],
    ...(config.defaults === undefined
      ? []
      : [[defaults, JSON.stringify({ compilerOptions: config.defaults })] as const]),
  ]);
  const label = `typescript ${compiler.version} (${compiler.directory})`;
  let client: Native.Client;
  try {
    client =
      modules.dialect === 'create-snapshot'
        ? new modules.sync.API({ cwd: process.cwd() })
        : new modules.sync.API({
            cwd: process.cwd(),
            fs: {
              readFile: (file) => texts.get(file),
              fileExists: (file) => (texts.has(file) ? true : undefined),
            },
          });
  } catch (error) {
    throw new TypeScriptCompilerError(`${label}: процесс компилятора не поднялся: ${describeThrown(error)}`, {
      cause: error,
    });
  }
  let snapshot: Native.Snapshot | undefined;
  let closed = false;
  const dispose = (): void => {
    if (!closed) {
      closed = true;
      try {
        snapshot?.dispose();
      } finally {
        client.close();
      }
    }
  };
  try {
    let project: Native.Project | undefined;
    if (modules.dialect === 'create-snapshot') {
      snapshot = client.createSnapshot?.({
        openProjects: [virtual],
        fileSystem: modules.fs?.createFileSystemLayer([...texts]),
      });
      project = snapshot?.getConfiguredProject?.(virtual);
    } else {
      snapshot = client.updateSnapshot?.({ openProjects: [virtual] });
      project = snapshot?.getProject?.(virtual);
    }
    if (project === undefined) {
      throw new TypeScriptCompilerError(`${label}: проект не открылся`);
    }
    // Объекты типов — экземпляры класса, которого вход не экспортирует: их форма сверяется на первом типе.
    const missing = missingMembers(
      project.checker.getStringType(),
      'Type',
      TYPE_SCRIPT_API.nativeType,
      'present',
    );
    if (missing.length > 0) {
      throw new TypeScriptCompilerError(`${label}: форма API не узнана — нет ${missing.join(', ')}`);
    }
    if (tsconfig !== undefined) {
      // Как readConfigFile у 5.9/6.x: файл не читается (5083) или синтаксис JSON (коды 1xxx в самом файле).
      const unreadable = project.program
        .getConfigFileParsingDiagnostics()
        .find(
          (diagnostic) =>
            (diagnostic.code === 5083 &&
              (diagnostic.text ?? diagnostic.messageText ?? '').includes(tsconfig)) ||
            (diagnostic.fileName === tsconfig && diagnostic.code >= 1000 && diagnostic.code < 2000),
        );
      if (unreadable !== undefined) {
        throw new ContractDefinitionError(
          'tsconfig',
          tsconfig,
          unreadable.text ?? unreadable.messageText ?? '',
        );
      }
    }
    const { program } = project;
    return {
      sourceFile: (file) => program.getSourceFile(resolve(file)),
      checker: nativeChecker(modules, project, compiler),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
