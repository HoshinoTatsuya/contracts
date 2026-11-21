/** Одна проверка гейта: имя (заголовок `it`) и проверка, бросающая ошибку с причиной. */
export interface GateCheck {
  readonly name: string;
  readonly run: () => void;
}
