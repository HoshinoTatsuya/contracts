/**
 * Компилятор TypeScript, которым снимается форма, не годится: пакет не
 * найден, его программный API незнакомой формы (TS 7 называет свой API
 * нестабильным, и форма меняется между минорами) или процесс компилятора не
 * поднялся. Отказ называет версию, каталог пакета и то, чего не хватило, —
 * а не `TypeError` из глубины разбора.
 */
export class TypeScriptCompilerError extends Error {
  public override readonly name = 'TypeScriptCompilerError';

  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
  }
}
