/**
 * `process` основного realm Node. Под jest код пакета исполняется в
 * vm-контексте с КОПИЕЙ `process`, и jest 30.5+ подменяет у копии
 * `getBuiltinModule` своим реестром модулей, который ESM без
 * `--experimental-vm-modules` не загружает (`Must use import to load ES
 * Module`), — а синхронный API TypeScript 7 — ESM. Конструктор функций
 * основного realm берётся у встроенной функции Node, которую окружение jest
 * отдаёт как есть (`Buffer`); вне jest это тот же realm и тот же `process`.
 * Не нашли настоящий `process` с `getBuiltinModule` — `process` текущего
 * контекста.
 */
export function hostProcess(): NodeJS.Process {
  const HostFunction = Buffer.constructor as FunctionConstructor;
  const host = new HostFunction('return typeof process === "object" ? process : undefined')() as
    | NodeJS.Process
    | undefined;
  return typeof host?.getBuiltinModule === 'function' ? host : process;
}
