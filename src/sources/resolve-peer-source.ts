import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PeerSource } from '../types/peer-source.type';

/**
 * Относительные пути источника — от `base` (рабочий каталог CLI, `root`
 * гейта), а не от каталога процесса: jest в монорепозитории запускается из
 * корня рабочего пространства, и `../reader` указывал бы мимо. Репозиторий
 * развёрнутой ревизии, которого нет на диске, — адрес (URL), он не трогается;
 * адрес `clone:` — тоже.
 */
export function resolvePeerSource(source: PeerSource, base: string): PeerSource {
  switch (source.kind) {
    case 'file':
      return { ...source, path: resolve(base, source.path) };
    case 'git':
      return { ...source, repo: resolve(base, source.repo) };
    case 'deployed':
      return {
        ...source,
        record: resolve(base, source.record),
        repo: existsSync(resolve(base, source.repo)) ? resolve(base, source.repo) : source.repo,
      };
    case 'clone':
      return source;
  }
}
