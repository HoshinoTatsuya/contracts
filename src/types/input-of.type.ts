/** Тип данных на входе схемы Zod 4 (`z.input`) — то, что кладёт писатель. */
export type InputOf<S> = S extends { readonly _zod: { readonly input: infer I } } ? I : unknown;
