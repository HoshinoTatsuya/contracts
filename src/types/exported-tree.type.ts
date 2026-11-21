/** Дерево ревизии во временном каталоге; `dispose()` его удаляет. */
export interface ExportedTree {
  readonly dir: string;
  dispose(): void;
}
