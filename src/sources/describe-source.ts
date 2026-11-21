import type { PeerSource } from '../types/peer-source.type';

/** Источник снимка строкой — для сообщений и обратного разбора `parsePeerSource`. */
export function describeSource(source: PeerSource): string {
  switch (source.kind) {
    case 'file':
      return `file:${source.path}`;
    case 'git':
      return `git:${source.repo}#${source.ref}:${source.path}`;
    case 'clone':
      return `clone:${source.url}#${source.ref}:${source.path}`;
    case 'deployed':
      return `deployed:${source.record}@${source.repo}`;
  }
}
