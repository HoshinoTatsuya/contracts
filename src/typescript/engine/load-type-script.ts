import { join } from 'node:path';

import { TypeScriptCompilerError } from '../../errors/type-script-compiler.error';
import type { TypeScriptEngine } from '../../types/type-script-engine.type';
import { loadCompilerPackage } from './load-compiler-package';
import { TYPE_SCRIPT_API } from './type-script-api.constant';

/**
 * Компилятор, которым снимается форма. Без имени — `typescript`, видимый
 * пакету (peer-зависимость): JS API 5.9/6.x или синхронный API 7.0/7.1 — по
 * фактической форме пакета. Если `typescript` нет или форма его API незнакома
 * (будущий 7.x переложит нестабильный API ещё раз), — запасной
 * `@typescript/typescript6` (прежний JS API, TypeScript 6), если он
 * установлен; иначе — отказ с обеими причинами. С именем (псевдоним вроде
 * `typescript-7`) — ровно этот пакет от текущего каталога процесса, без
 * запасного: названный компилятор подменять нельзя.
 *
 * Загружается при первом вызове, а не при импорте подпути: без `typescript`
 * подпуть импортируется, а вызов — отказ с причиной.
 */
export function loadTypeScript(compiler?: string): TypeScriptEngine {
  if (compiler !== undefined) {
    return loadCompilerPackage(compiler, join(process.cwd(), 'package.json'));
  }
  try {
    return loadCompilerPackage('typescript', __filename);
  } catch (error) {
    if (!(error instanceof TypeScriptCompilerError)) {
      throw error;
    }
    try {
      return loadCompilerPackage(TYPE_SCRIPT_API.fallback, __filename);
    } catch (fallback) {
      if (!(fallback instanceof TypeScriptCompilerError)) {
        throw fallback;
      }
      throw new TypeScriptCompilerError(
        `${error.message}; запасной ${TYPE_SCRIPT_API.fallback} тоже не годится: ${fallback.message}. ` +
          'Нужен typescript 5.9, 6.x или 7.0–7.1 либо @typescript/typescript6',
        { cause: error },
      );
    }
  }
}
