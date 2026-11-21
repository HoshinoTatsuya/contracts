/**
 * Собственное перечислимое свойство словаря — присваиванием, которое не
 * трогает прототип. `target[key] = value` с ключом `__proto__` подменил бы
 * прототип объекта вместо записи поля: поле пропало бы из снимка, а в payload
 * пришедший `__proto__` стал бы прототипом результата чтения.
 */
export function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
