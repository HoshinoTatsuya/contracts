import { emulateCmdExe } from '../testing/emulate-cmd-exe';
import { buildCmdInvocation } from './build-cmd-invocation';

/**
 * Строка запуска `.cmd` проверяется моделью cmd.exe + MSVCRT (`emulateCmdExe`,
 * строже настоящего): программа и КАЖДЫЙ аргумент обязаны дойти буквально.
 * Контроли ниже доказывают, что модель отличает сломанную строку от верной.
 */
describe('buildCmdInvocation: cmd.exe /d /s /c "<строка>" для обёртки .cmd', () => {
  const wrapper = 'C:\\Program Files (x86)\\A&B %USERPROFILE% ^!;\\node_modules\\.bin\\biome.cmd';
  const hostile = [
    'format',
    '--stdin-file-path=a b/c&d|e<f>g^h%PATH%i!j"k\'l(m)n,o;p=q*r?s`t[u]v',
    '%',
    '100%',
    '%%',
    'trailing\\',
    'back\\"slash',
    'C:\\dir with space\\',
    '',
    '"',
    '^',
  ];

  it('программа и каждый аргумент (пробелы, кавычки, %, ^, &, !, слэши, пустой) доходят буквально', () => {
    const invocation = buildCmdInvocation(wrapper, hostile, 'C:\\Windows\\system32\\cmd.exe');
    expect(invocation.command).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(emulateCmdExe(invocation.args)).toEqual({ program: wrapper, argv: hostile });
  });

  it.each(hostile.map((arg) => [arg]))('по одному: %j', (arg) => {
    expect(emulateCmdExe(buildCmdInvocation(wrapper, [arg], 'cmd.exe').args).argv).toEqual([arg]);
  });

  it('comspec по умолчанию — из окружения, иначе cmd.exe', () => {
    const saved = process.env.comspec;
    try {
      process.env.comspec = 'D:\\cmd.exe';
      expect(buildCmdInvocation('a.cmd', []).command).toBe('D:\\cmd.exe');
      delete process.env.comspec;
      expect(buildCmdInvocation('a.cmd', []).command).toBe('cmd.exe');
    } finally {
      if (saved === undefined) {
        delete process.env.comspec;
      } else {
        process.env.comspec = saved;
      }
    }
  });

  it('путь обёртки с кавычкой или переводом строки — отказ до запуска', () => {
    expect(() => buildCmdInvocation('a"b.cmd', [])).toThrow(/cmd\.exe/);
    expect(() => buildCmdInvocation('a\nb.cmd', [])).toThrow(/cmd\.exe/);
  });

  describe('контроли модели cmd.exe: сломанная строка — отказ или искажение', () => {
    // Так склеивал Node при shell: true с аргументами в кавычках.
    it('%VAR% в кавычках — раскрылось бы', () => {
      expect(() => emulateCmdExe(['/d', '/s', '/c', '""x.cmd" "%PATH%""'])).toThrow(/раскрыл/);
    });

    it('& вне кавычек — команда разрезана', () => {
      expect(() => emulateCmdExe(['/d', '/s', '/c', '"x.cmd a & b"'])).toThrow(/разрезал/);
    });

    it('обёртка .cmd снимает ^ дважды: одинарно экранированный ^ теряется', () => {
      expect(emulateCmdExe(['/d', '/s', '/c', '"x.cmd ^^^"a^ b^^^" c^^d"']).argv).toEqual(['a b', 'cd']);
    });

    it('MSVCRT: \\" — кавычка, \\\\" — слэш и граница кавычек', () => {
      expect(emulateCmdExe(['/d', '/s', '/c', '"x.exe "a\\"b" "c\\\\" d"']).argv).toEqual([
        'a"b',
        'c\\',
        'd',
      ]);
    });

    it('не /d /s /c "<строка>" — отказ', () => {
      expect(() => emulateCmdExe(['/c', 'x.cmd'])).toThrow(/ждёт/);
    });
  });
});
