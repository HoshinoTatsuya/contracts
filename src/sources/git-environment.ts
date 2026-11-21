/**
 * Окружение git без интерактива. Запрос пароля в CI повис бы до таймаута
 * джобы, а локально — до таймаута проверки:
 *
 * - `GIT_TERMINAL_PROMPT=0` — git не спрашивает в терминале;
 * - `GIT_ASKPASS=''` — пустая строка (а не отсутствие) у git выключает и
 *   `core.askPass`, и `SSH_ASKPASS` для своих запросов;
 * - ssh спрашивает сам (пароль ключа, неизвестный хост) мимо git: если
 *   вызывающий не задал свою команду (`GIT_SSH_COMMAND`/`GIT_SSH`) — `ssh -o
 *   BatchMode=yes`, и `SSH_ASKPASS_REQUIRE=never`;
 * - `LC_ALL=C` — текст ошибки git для отчёта не зависит от локали.
 */
export function gitEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ownSsh = (base.GIT_SSH_COMMAND ?? '') !== '' || (base.GIT_SSH ?? '') !== '';
  return {
    ...base,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    ...(ownSsh ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
    LC_ALL: 'C',
  };
}
