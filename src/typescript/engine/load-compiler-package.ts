import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { TypeScriptCompilerError } from '../../errors/type-script-compiler.error';
import type { TypeScriptEngine } from '../../types/type-script-engine.type';
import { ENGINE_CACHE } from './engine-cache.constant';
import { nativeRequire } from './native-require';
import { selectEngine } from './select-engine';

/**
 * Пакет компилятора `name`, резолвленный от файла `from`, и движок по его
 * фактическому API (с кэшем по package.json пакета). Нет пакета — отказ
 * «не найден», незнакомая форма API — отказ «не узнана».
 */
export function loadCompilerPackage(name: string, from: string): TypeScriptEngine {
  const load = nativeRequire(from);
  let main: string;
  try {
    main = load.resolve(name);
  } catch (error) {
    throw new TypeScriptCompilerError(`пакет ${name} не найден от ${dirname(from)}`, { cause: error });
  }
  // package.json пакета — ближайший вверх от входа с именем (вход TS 7 — lib/version.cjs, у 5.9/6.x —
  // lib/typescript.js); package.json подкаталога вида `{"type":"module"}` имени не несёт и пропускается.
  const named = (directory: string): boolean =>
    existsSync(join(directory, 'package.json')) &&
    typeof (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown }).name ===
      'string';
  let directory = dirname(main);
  while (!named(directory) && dirname(directory) !== directory) {
    directory = dirname(directory);
  }
  const manifest = join(directory, 'package.json');
  const cached = ENGINE_CACHE.get(manifest);
  if (cached !== undefined) {
    return cached;
  }
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };
  const engine = selectEngine(name, (id) => load(id), { version: String(version), directory });
  ENGINE_CACHE.set(manifest, engine);
  return engine;
}
