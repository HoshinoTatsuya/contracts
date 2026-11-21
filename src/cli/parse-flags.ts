/**
 * `--ключ значение`, `--ключ=значение` и `--флаг` (без значения, если следующий аргумент — тоже
 * флаг или аргументов больше нет). Неизвестный ключ или позиционный аргумент —
 * отказ: опечатка в имени флага не должна молча выключать проверку. Повтор
 * флага — тоже отказ, а не «последний победил».
 */
export function parseFlags(
  args: readonly string[],
  allowed: readonly string[],
  booleans: readonly string[] = [],
): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (!arg.startsWith('--')) {
      throw new Error(`лишний аргумент «${arg}»`);
    }
    // `--ключ=значение` — то же, что `--ключ значение`.
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    if (!allowed.includes(name) && !booleans.includes(name)) {
      throw new Error(`неизвестный флаг --${name}`);
    }
    if (Object.hasOwn(flags, name)) {
      throw new Error(`флаг --${name} указан дважды: какое значение имелось в виду, не угадать`);
    }
    if (booleans.includes(name)) {
      if (inline !== undefined) {
        throw new Error(`флаг --${name} без значения, а передано «${inline}»`);
      }
      flags[name] = 'true';
      continue;
    }
    if (inline !== undefined) {
      if (inline === '') {
        throw new Error(`у флага --${name} нет значения`);
      }
      flags[name] = inline;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`у флага --${name} нет значения`);
    }
    flags[name] = value;
    index += 1;
  }
  return flags;
}
