/**
 * То, что гейту нужно от своего контракта на рантайме: имя, поле версии и
 * чтение. Любой `defineContract(...)` подходит как есть — с любыми типами
 * входа и выхода (класс `Contract` с параметрами `<unknown, never, unknown>`
 * не принимал контракт с конкретным входом: `write` возвращает вход).
 */
export interface RuntimeReader {
  readonly name: string;
  readonly versionField: string | null;
  read(payload: unknown): unknown;
}
