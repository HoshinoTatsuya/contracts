import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import { SnapshotFormatError } from '../errors/snapshot-format.error';
import { parseSnapshot } from '../snapshot/parse-snapshot';
import type { PeerSource } from '../types/peer-source.type';
import type { SnapshotDocument } from '../types/snapshot-document.type';
import { assertGitArgument } from './assert-git-argument';
import { describeSource } from './describe-source';
import { readDeployedRecord } from './read-deployed-record';
import { runGit } from './run-git';

/**
 * Снимок ДРУГОЙ стороны — той версии, с которой сверяться: файл, ревизия
 * локального клона, ревизия удалённого репозитория или развёрнутая ревизия
 * по записи `recordDeployed`. Любой отказ добыть или разобрать —
 * `PeerSnapshotUnavailableError`: пропуск проверки здесь был бы зелёной
 * галочкой за непроверенным. `timeoutMs` (по умолчанию 120 с) — потолок на
 * всю добычу: каждый вызов git получает остаток, исчерпан — отказ.
 */
export function loadPeerSnapshot(
  source: PeerSource,
  options: { readonly timeoutMs?: number } = {},
): SnapshotDocument {
  const label = describeSource(source);
  // Потолок — на ВСЮ добычу, а не на каждый вызов git: клон из трёх вызовов не вправе занять три потолка.
  const budget = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + budget;
  const remaining = (): number => {
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new PeerSnapshotUnavailableError(label, `потолок времени ${budget} мс на добычу снимка исчерпан`);
    }
    return left;
  };
  const parse = (text: string): SnapshotDocument => {
    try {
      return parseSnapshot(text, label);
    } catch (error) {
      if (error instanceof SnapshotFormatError) {
        throw new PeerSnapshotUnavailableError(label, error.message);
      }
      throw error;
    }
  };
  const gitPath = (path: string): string => path.split('\\').join('/').replace(/^\.\//, '');
  const fromRepo = (repo: string, ref: string, path: string): string => {
    assertGitArgument(ref, 'ревизия', label);
    assertGitArgument(gitPath(path), 'путь', label);
    if (!existsSync(repo)) {
      throw new PeerSnapshotUnavailableError(label, `нет репозитория ${repo}`);
    }
    return runGit(['-C', repo, 'show', '--end-of-options', `${ref}:${gitPath(path)}`], {
      source: label,
      timeoutMs: remaining(),
    }).toString('utf8');
  };
  const fromRemote = (url: string, ref: string, path: string): string => {
    assertGitArgument(url, 'адрес репозитория', label);
    assertGitArgument(ref, 'ревизия', label);
    assertGitArgument(gitPath(path), 'путь', label);
    const directory = mkdtempSync(join(tmpdir(), 'contracts-peer-'));
    try {
      const git = (args: readonly string[]): Buffer =>
        runGit(args, { cwd: directory, source: label, timeoutMs: remaining() });
      git(['init', '-q']);
      git(['fetch', '-q', '--depth', '1', '--no-tags', '--end-of-options', url, ref]);
      return git(['show', '--end-of-options', `FETCH_HEAD:${gitPath(path)}`]).toString('utf8');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  switch (source.kind) {
    case 'file': {
      if (!existsSync(source.path)) {
        throw new PeerSnapshotUnavailableError(label, 'нет файла или каталога');
      }
      const file = statSync(source.path).isDirectory()
        ? join(source.path, CONTRACT_FORMAT.SNAPSHOT_FILE)
        : source.path;
      if (!existsSync(file)) {
        throw new PeerSnapshotUnavailableError(label, `в каталоге нет ${CONTRACT_FORMAT.SNAPSHOT_FILE}`);
      }
      return parse(readFileSync(file, 'utf8'));
    }
    case 'git':
      return parse(fromRepo(source.repo, source.ref, source.path));
    case 'clone':
      return parse(fromRemote(source.url, source.ref, source.path));
    case 'deployed': {
      const record = readDeployedRecord(source.record);
      const local = existsSync(source.repo) && statSync(source.repo).isDirectory();
      return parse(
        local
          ? fromRepo(source.repo, record.ref, record.snapshotPath)
          : fromRemote(source.repo, record.ref, record.snapshotPath),
      );
    }
  }
}
