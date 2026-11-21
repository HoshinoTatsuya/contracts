import { describeThrown } from './describe-thrown';

/**
 * Вызов хука наблюдателя, который не роняет чтение: исключение метрики уходит
 * предупреждением процесса — видно, но бизнес-чтение не страдает от отказа
 * наблюдения.
 */
export function notifyObserver<E>(hook: ((event: E) => void) | undefined, event: E): void {
  if (hook === undefined) {
    return;
  }
  try {
    hook(event);
  } catch (error) {
    process.emitWarning(
      `хук наблюдателя контракта упал: ${describeThrown(error, 'message')}`,
      'ContractObserverWarning',
    );
  }
}
