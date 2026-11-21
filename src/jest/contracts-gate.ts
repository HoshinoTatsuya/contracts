import type { ContractsGateOptions } from '../types/contracts-gate-options.type';
import type { TestRegistrar } from '../types/test-registrar.type';
import { gateChecks } from './gate-checks';
import { jestRegistrar } from './jest-registrar';

/**
 * Гейт контрактов в спеке проекта: проверки `gateChecks` — как `describe`/`it`
 * (по умолчанию jest; другой раннер — вторым аргументом, например
 * `{ describe, it }` из vitest: тогда `@jest/globals` не загружается вовсе).
 *
 * Гейт, читающий второй репозиторий, место которому в отдельной джобе CI
 * (CLI `contracts check`), — та, что его ДОБЫВАЕТ: в наборе по умолчанию без
 * второго репозитория он был бы красным всегда, и его бы отключили.
 */
export function contractsGate(options: ContractsGateOptions, registrar?: TestRegistrar): void {
  const registry = registrar ?? jestRegistrar();
  const { title, checks } = gateChecks(options);
  registry.describe(title, () => {
    for (const check of checks) {
      registry.it(check.name, () => {
        check.run();
      });
    }
  });
}
