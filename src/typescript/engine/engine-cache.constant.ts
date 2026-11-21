import type { TypeScriptEngine } from '../../types/type-script-engine.type';

/**
 * Загруженные компиляторы по пути к их package.json: модуль TypeScript
 * 5.9/6.x грузится сотни миллисекунд, и каждая программа не должна платить
 * это заново. Процессы TS 7 сюда не попадают — они у программ.
 */
export const ENGINE_CACHE = new Map<string, TypeScriptEngine>();
