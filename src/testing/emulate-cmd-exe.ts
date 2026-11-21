import type { CmdChar } from './cmd-char.type';

/**
 * Модель cmd.exe и разбора argv программой — чтобы проверять строку запуска
 * `.cmd` без Windows. Сознательно строже настоящего cmd.exe:
 *  - фаза 1 (раскрытие `%`): любое `%имя%` с именем без `^` считается
 *    ОПРЕДЕЛЁННОЙ переменной — отказ «раскрылось бы»; имя с `^` в командной
 *    строке не определено и остаётся как есть (так cmd.exe и поступает);
 *  - фаза 2: вне кавычек `^x` → `x`, неэкранированные `&`, `|`, `<`, `>` —
 *    отказ «команда разрезана»; внутри кавычек всё буквально;
 *  - `/s /c "…"`: снимаются первая и последняя кавычки;
 *  - программа `.cmd`/`.bat` передаёт хвост через `%*`: хвост проходит фазу 2
 *    ещё раз (подставленный текст фазу 1 повторно не проходит);
 *  - итоговая строка делится на argv по правилам MSVCRT (CommandLineToArgvW).
 */
export const emulateCmdExe = (
  cmdArgs: readonly string[],
): { readonly program: string; readonly argv: readonly string[] } => {
  const isBlank = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';

  /** Фаза 1: `%имя%` без `^` в имени — переменная, которую cmd.exe подставил бы. */
  const expandPercent = (line: string): void => {
    let from = line.indexOf('%');
    while (from !== -1) {
      const to = line.indexOf('%', from + 1);
      if (to === -1) {
        return;
      }
      const name = line.slice(from + 1, to);
      if (name.length > 0 && !name.includes('^')) {
        throw new Error(`cmd.exe раскрыл бы %${name}%: ${line}`);
      }
      from = to;
    }
  };

  /** Фаза 2: снятие `^` вне кавычек; неэкранированный разделитель команд — отказ. */
  const caretPass = (text: string): CmdChar[] => {
    const out: CmdChar[] = [];
    let inQuotes = false;
    for (let index = 0; index < text.length; index += 1) {
      const ch = text[index] as string;
      if (ch === '\r' || ch === '\n') {
        throw new Error('перевод строки обрывает команду cmd.exe');
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        out.push({ ch, literal: false });
      } else if (inQuotes) {
        out.push({ ch, literal: true });
      } else if (ch === '^') {
        index += 1;
        if (index >= text.length) {
          throw new Error(`висящий ^ в конце: ${text}`);
        }
        out.push({ ch: text[index] as string, literal: true });
      } else if ('&|<>'.includes(ch)) {
        throw new Error(`cmd.exe разрезал бы команду на «${ch}»: ${text}`);
      } else {
        out.push({ ch, literal: false });
      }
    }
    return out;
  };

  /** Разбор командной строки в argv программой MSVCRT (CommandLineToArgvW). */
  const splitArgv = (line: string): string[] => {
    const argv: string[] = [];
    let current = '';
    let started = false;
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const ch = line[index] as string;
      if (ch === '\\') {
        let slashes = 0;
        while (line[index] === '\\') {
          slashes += 1;
          index += 1;
        }
        if (line[index] === '"') {
          current += '\\'.repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) {
            current += '"';
          } else {
            index -= 1;
          }
        } else {
          current += '\\'.repeat(slashes);
          index -= 1;
        }
        started = true;
      } else if (ch === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        started = true;
      } else if (isBlank(ch) && !inQuotes) {
        if (started) {
          argv.push(current);
        }
        current = '';
        started = false;
      } else {
        current += ch;
        started = true;
      }
    }
    if (started) {
      argv.push(current);
    }
    return argv;
  };

  const [d, s, c, quoted, ...extra] = cmdArgs;
  if (d !== '/d' || s !== '/s' || c !== '/c' || quoted === undefined || extra.length > 0) {
    throw new Error(`cmd.exe ждёт /d /s /c "<строка>", получено ${JSON.stringify(cmdArgs)}`);
  }
  if (quoted.length < 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) {
    throw new Error(`строка после /s /c не в кавычках: ${quoted}`);
  }
  const line = quoted.slice(1, -1);
  expandPercent(line);
  const parsed = caretPass(line);
  let index = 0;
  let program = '';
  while (index < parsed.length && !(isBlank(parsed[index]?.ch) && parsed[index]?.literal === false)) {
    const char = parsed[index] as CmdChar;
    if (!(char.ch === '"' && !char.literal)) {
      program += char.ch;
    }
    index += 1;
  }
  while (index < parsed.length && isBlank(parsed[index]?.ch) && parsed[index]?.literal === false) {
    index += 1;
  }
  const tail = parsed
    .slice(index)
    .map((char) => char.ch)
    .join('');
  const forwarded = /\.(?:cmd|bat)$/i.test(program)
    ? caretPass(tail)
        .map((char) => char.ch)
        .join('')
    : tail;
  return { program, argv: splitArgv(forwarded) };
};
