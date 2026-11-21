import { PeerSnapshotUnavailableError } from '../errors/peer-snapshot-unavailable.error';
import type { PeerSource } from '../types/peer-source.type';

/**
 * Источник снимка из строки CLI:
 * `file:<путь>` (или просто путь), `git:<репозиторий>#<ref>:<путь>`,
 * `clone:<url>#<ref>:<путь>`, `deployed:<запись>@<репозиторий или url>`.
 * Ревизия отделяется ПОСЛЕДНИМ `#`, путь — первым `:` после него (в имени
 * ref git двоеточия не допускает), поэтому `C:\…` и `https://…` разбираются.
 */
export function parsePeerSource(text: string): PeerSource {
  const fail = (detail: string): never => {
    throw new PeerSnapshotUnavailableError(text, detail);
  };
  const located = (rest: string): { readonly where: string; readonly ref: string; readonly path: string } => {
    const hash = rest.lastIndexOf('#');
    if (hash <= 0) {
      return fail('ожидалось <где>#<ref>:<путь>');
    }
    const tail = rest.slice(hash + 1);
    const colon = tail.indexOf(':');
    if (colon <= 0 || colon === tail.length - 1) {
      return fail('ожидалось <где>#<ref>:<путь>');
    }
    return { where: rest.slice(0, hash), ref: tail.slice(0, colon), path: tail.slice(colon + 1) };
  };
  if (text.startsWith('git:')) {
    const { where, ref, path } = located(text.slice(4));
    return { kind: 'git', repo: where, ref, path };
  }
  if (text.startsWith('clone:')) {
    const { where, ref, path } = located(text.slice(6));
    return { kind: 'clone', url: where, ref, path };
  }
  if (text.startsWith('deployed:')) {
    const rest = text.slice(9);
    const at = rest.indexOf('@');
    if (at <= 0 || at === rest.length - 1) {
      return fail('ожидалось deployed:<запись>@<репозиторий>');
    }
    return { kind: 'deployed', record: rest.slice(0, at), repo: rest.slice(at + 1) };
  }
  const path = text.startsWith('file:') ? text.slice(5) : text;
  return path === '' ? fail('пустой путь') : { kind: 'file', path };
}
