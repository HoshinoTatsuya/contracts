/** Символ после разбора cmd.exe: `literal` — экранирован `^` или внутри кавычек. */
export type CmdChar = { readonly ch: string; readonly literal: boolean };
