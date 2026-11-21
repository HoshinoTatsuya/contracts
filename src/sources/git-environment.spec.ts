import { gitEnvironment } from './git-environment';

/** Внешние процессы без интерактива и без разрезанной командной строки. */
describe('окружение git', () => {
  it('без своей команды ssh — BatchMode; запросы git и ssh выключены', () => {
    const env = gitEnvironment({ PATH: '/bin', GIT_ASKPASS: '/usr/bin/gui-askpass' });
    expect({
      prompt: env.GIT_TERMINAL_PROMPT,
      askpass: env.GIT_ASKPASS,
      sshAskpass: env.SSH_ASKPASS_REQUIRE,
      ssh: env.GIT_SSH_COMMAND,
      path: env.PATH,
    }).toEqual({ prompt: '0', askpass: '', sshAskpass: 'never', ssh: 'ssh -o BatchMode=yes', path: '/bin' });
  });

  it('своя команда ssh вызывающего не подменяется', () => {
    expect(gitEnvironment({ GIT_SSH_COMMAND: 'ssh -i key' }).GIT_SSH_COMMAND).toBe('ssh -i key');
    expect(gitEnvironment({ GIT_SSH: '/usr/bin/plink' }).GIT_SSH_COMMAND).toBeUndefined();
  });
});
