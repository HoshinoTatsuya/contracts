/**
 * Откуда взять снимок ДРУГОЙ стороны. Не добыли — отказ проверки, а не пропуск.
 *
 * - `file` — файл снимка или каталог с `contracts.snapshot.json`;
 * - `git` — `git show <ref>:<path>` в локальном клоне (ветка по умолчанию на
 *   момент последнего fetch — `refs/remotes/origin/HEAD`, а не рабочее дерево);
 * - `clone` — `git fetch --depth 1 <url> <ref>` во временный каталог;
 * - `deployed` — запись о развёрнутой ревизии другой стороны
 *   (`recordDeployed`) плюс её репозиторий (локальный путь или URL).
 */
export type PeerSource =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'git'; readonly repo: string; readonly ref: string; readonly path: string }
  | { readonly kind: 'clone'; readonly url: string; readonly ref: string; readonly path: string }
  | { readonly kind: 'deployed'; readonly record: string; readonly repo: string };
