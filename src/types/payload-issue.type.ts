/** Отказ разбора payload: путь к полю (`meta.httpCode`, `items.2`) и текст. */
export interface PayloadIssue {
  readonly path: string;
  readonly message: string;
}
