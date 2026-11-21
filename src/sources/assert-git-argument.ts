import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';

/**
 * Ревизия, адрес и путь, которые уходят в git, не начинаются с `-`: иначе git
 * принял бы их за опцию (`--output=<файл>` у `show`/`archive`, `--upload-pack=<команда>`
 * у `fetch`). Значение приходит из конфигурации CI, то есть от того, кто вправе
 * менять конфигурацию, но не исполнять команды на раннере. Отказ — до вызова
 * git; вызовы, кроме того, разделяют опции и позиционные аргументы
 * `--end-of-options`.
 */
export function assertGitArgument(value: string, what: string, source: string): void {
  if (value === '') {
    throw new PeerSnapshotUnavailableError(source, `${what}: пустое значение`);
  }
  if (value.startsWith('-')) {
    throw new PeerSnapshotUnavailableError(
      source,
      `${what} ${JSON.stringify(value)} начинается с «-»: git принял бы его за опцию`,
    );
  }
}
