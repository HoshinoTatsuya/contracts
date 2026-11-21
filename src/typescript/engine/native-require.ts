import type { createRequire } from 'node:module';

import { hostProcess } from './host-process';

/**
 * `require` загрузчика Node от файла `from`. Не `import { createRequire } from
 * 'node:module'` и не `process.getBuiltinModule` текущего контекста: под jest
 * оба отданы реестру jest, который не загружает ESM, а программный API
 * TypeScript 7 — ESM (`require(esm)` умеет только загрузчик Node 22.12+).
 * `getBuiltinModule` настоящего `process` (`hostProcess`) даёт настоящий
 * модуль мимо реестра — и потребитель может звать пакет из своих спек jest.
 */
export function nativeRequire(from: string): ReturnType<typeof createRequire> {
  return hostProcess().getBuiltinModule('node:module').createRequire(from);
}
