/** Чем гейт регистрирует проверки: `describe`/`it` jest по умолчанию, или свои (vitest, node:test). */
export interface TestRegistrar {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void): void;
}
