import { ContractDefinitionError } from '../errors/contract-definition.error';
import { quoteCmdArgument } from './quote-cmd-argument';

/**
 * Запуск обёртки `node_modules/.bin/<имя>.cmd` на Windows. `.cmd` Node без
 * оболочки не запускает (EINVAL, CVE-2024-27980), а `shell: true` с массивом
 * аргументов с Node 24 даёт DeprecationWarning DEP0190 (в будущем — отказ) и
 * склеивает аргументы без экранирования. Поэтому строку для cmd.exe собирает
 * библиотека: `cmd.exe /d /s /c "<программа> <аргументы>"` с
 * `windowsVerbatimArguments` — Node передаёт её как есть. Программа — без
 * кавычек, с `^` перед метасимволами; аргументы — `quoteCmdArgument`.
 */
export function buildCmdInvocation(
  wrapper: string,
  args: readonly string[],
  comspec: string = process.env.comspec ?? 'cmd.exe',
): { readonly command: string; readonly args: readonly string[] } {
  if (/[\r\n\0"]/.test(wrapper)) {
    throw new ContractDefinitionError(
      'снимок',
      wrapper,
      'путь форматтера с « " » или переводом строки не выразить в командной строке cmd.exe',
    );
  }
  const program = wrapper.replace(/([()\][%!^"`<>&|;, *?])/g, '^$1');
  const line = [program, ...args.map(quoteCmdArgument)].join(' ');
  return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`] };
}
