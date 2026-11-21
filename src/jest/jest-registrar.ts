import type { TestRegistrar } from '../types/test-registrar.type';

/**
 * `describe`/`it` jest — только по требованию: `@jest/globals` бросает
 * исключение при импорте вне jest, и статический импорт делал подпуть
 * `./jest` непригодным для vitest и `node:test` даже со своими функциями.
 */
export function jestRegistrar(): TestRegistrar {
  const globals = require('@jest/globals') as {
    readonly describe: TestRegistrar['describe'];
    readonly it: TestRegistrar['it'];
  };
  return { describe: globals.describe, it: globals.it };
}
