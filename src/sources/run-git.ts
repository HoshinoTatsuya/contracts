import { spawnSync } from 'node:child_process';

import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import { gitEnvironment } from './git-environment';

/**
 * Вызов git без оболочки и без интерактива (`gitEnvironment`) и с потолком
 * времени. Любой
 * ненулевой код — `PeerSnapshotUnavailableError` с текстом git.
 */
export function runGit(
  args: readonly string[],
  options: { readonly cwd?: string; readonly source: string; readonly timeoutMs?: number },
): Buffer {
  const run = spawnSync('git', [...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: gitEnvironment(process.env),
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (run.error !== undefined) {
    throw new PeerSnapshotUnavailableError(options.source, `git ${args.join(' ')}: ${run.error.message}`);
  }
  if (run.status !== 0) {
    throw new PeerSnapshotUnavailableError(
      options.source,
      `git ${args.join(' ')} завершился с кодом ${String(run.status ?? run.signal)}: ${run.stderr.toString('utf8').trim()}`,
    );
  }
  return run.stdout;
}
