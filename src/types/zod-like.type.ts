/**
 * То, что библиотеке нужно от схемы Zod 4 (`zod`, `zod/mini`, `zod/v4` из 3.25):
 * описание `_zod.def` для снимка формы и Standard Schema `~standard` для разбора.
 * Сам пакет zod библиотека не импортирует. Тип намеренно узкий: подробная
 * форма результата `validate` расходилась бы с типами zod у потребителя с
 * `exactOptionalPropertyTypes` — результат разбирается на рантайме.
 */
export interface ZodLike {
  readonly _zod: { readonly def: { readonly type: string } };
  readonly '~standard': { readonly validate: (value: unknown) => unknown };
}
