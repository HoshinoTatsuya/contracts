import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { ContractDefinitionError } from '../errors/contract-definition.error';
import { buildCmdInvocation } from '../process/build-cmd-invocation';
import type { SnapshotDocument } from '../types/snapshot-document.type';
import type { SnapshotFormatter } from '../types/snapshot-formatter.type';
import { parseSnapshot } from './parse-snapshot';
import { serializeSnapshot } from './serialize-snapshot';
import { snapshotsEqual } from './snapshots-equal';

/**
 * Записать снимок и пропустить его через форматтер репозитория. Форматтер
 * ищется в `node_modules/.bin` от `cwd` вверх; не найден или упал — отказ:
 * снимок, записанный мимо форматтера, разошёлся бы с закоммиченным при первом
 * же форматировании дерева. После форматирования снимок перечитывается:
 * форматтер, изменивший СОДЕРЖАНИЕ, — тоже отказ. Форматтер вне
 * `node_modules/.bin` (Yarn PnP, глобальный, dprint/eslint с другими
 * аргументами) — функцией `formatter: (file) => …`.
 */
export function writeSnapshot(
  file: string,
  document: SnapshotDocument,
  options: { readonly formatter?: SnapshotFormatter; readonly cwd?: string } = {},
): void {
  const path = resolve(options.cwd ?? process.cwd(), file);
  if (existsSync(path) && statSync(path).isDirectory()) {
    throw new ContractDefinitionError(
      'снимок',
      file,
      'путь снимка — каталог; укажите файл (contracts.snapshot.json)',
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeSnapshot(document));
  const formatter = options.formatter ?? 'none';
  if (typeof formatter === 'function') {
    formatter(path);
  } else if (formatter !== 'none') {
    let directory = resolve(options.cwd ?? process.cwd());
    let binary: string | undefined;
    for (;;) {
      const candidate = join(
        directory,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? `${formatter}.cmd` : formatter,
      );
      if (existsSync(candidate)) {
        binary = candidate;
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
    if (binary === undefined) {
      throw new ContractDefinitionError(
        'снимок',
        file,
        `форматтер ${formatter} не найден в node_modules/.bin`,
      );
    }
    const args = formatter === 'biome' ? ['format', '--write', path] : ['--write', path];
    // На Windows `.cmd` запускается только через cmd.exe; строку собирает пакет, а не `shell: true` (DEP0190).
    const windows = process.platform === 'win32';
    const invocation = windows ? buildCmdInvocation(binary, args) : { command: binary, args };
    const run = spawnSync(invocation.command, [...invocation.args], {
      cwd: directory,
      encoding: 'utf8',
      windowsVerbatimArguments: windows,
    });
    if (run.error !== undefined) {
      throw new ContractDefinitionError(
        'снимок',
        file,
        `форматтер ${formatter} не запустился: ${run.error.message}`,
      );
    }
    if (run.status !== 0) {
      throw new ContractDefinitionError(
        'снимок',
        file,
        `форматтер ${formatter} завершился ${run.status === null ? `сигналом ${String(run.signal)}` : `с кодом ${run.status}`}: ${(run.stderr || run.stdout || '').trim()}`,
      );
    }
  }
  let written: string;
  try {
    written = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ContractDefinitionError(
      'снимок',
      file,
      `после форматтера снимок не прочитать: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!snapshotsEqual(parseSnapshot(written, path), document)) {
    throw new ContractDefinitionError('снимок', file, 'форматтер изменил содержание снимка');
  }
}
