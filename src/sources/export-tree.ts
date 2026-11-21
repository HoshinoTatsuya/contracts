import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import type { ExportedTree } from '../types/exported-tree.type';
import { assertGitArgument } from './assert-git-argument';
import { runGit } from './run-git';

/**
 * Дерево ревизии репозитория во временном каталоге (`git archive`), а не его
 * рабочее дерево: открытая там ветка с незакоммиченными правками — это не та
 * версия, что развёрнута. Нужно, когда другая сторона ещё не публикует
 * снимок, и его приходится снимать с её исходников (`typeScriptContract`).
 * Каталог удаляет `dispose()`.
 */
export function exportTree(repo: string, ref: string): ExportedTree {
  const label = `git:${repo}#${ref}`;
  assertGitArgument(ref, 'ревизия', label);
  if (!existsSync(repo)) {
    throw new PeerSnapshotUnavailableError(label, `нет репозитория ${repo}`);
  }
  const archive = runGit(['-C', repo, 'archive', '--format=tar', '--end-of-options', ref], { source: label });
  const dir = mkdtempSync(join(tmpdir(), 'contracts-tree-'));
  const unpack = spawnSync('tar', ['-x', '-C', dir], { input: archive, maxBuffer: 64 * 1024 * 1024 });
  if (unpack.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new PeerSnapshotUnavailableError(
      label,
      `tar -x: ${unpack.error?.message ?? unpack.stderr.toString('utf8').trim()}`,
    );
  }
  return {
    dir,
    dispose: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
