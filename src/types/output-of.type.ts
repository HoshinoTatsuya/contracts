/** Тип данных после разбора схемы Zod 4 (`z.output`). */
export type OutputOf<S> = S extends { readonly _zod: { readonly output: infer O } } ? O : unknown;
