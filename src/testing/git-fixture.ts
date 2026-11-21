import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Временный git-репозиторий для спек: без глобального конфига автора, без
 * подписи коммитов и без запроса пароля — одинаково на любой машине и в CI.
 */
export const gitFixture = {
  init(dir: string): void {
    mkdirSync(dir, { recursive: true });
    gitFixture.git(dir, ['init', '-q', '-b', 'main']);
  },
  git(dir: string, args: readonly string[]): string {
    return execFileSync(
      'git',
      [
        '-c',
        'user.name=fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 30_000 },
    ).trim();
  },
  /** Записать файлы и закоммитить; вернуть полный хэш коммита. */
  commit(dir: string, files: Readonly<Record<string, string>>, message: string): string {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    gitFixture.git(dir, ['add', '-A']);
    gitFixture.git(dir, ['commit', '-q', '-m', message]);
    return gitFixture.git(dir, ['rev-parse', 'HEAD']);
  },
};
