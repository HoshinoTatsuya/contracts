import childProcess from 'node:child_process';
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { defineContract } from '../runtime/define-contract';
import { createSnapshot } from '../snapshot/create-snapshot';
import { serializeSnapshot } from '../snapshot/serialize-snapshot';
import { gitFixture } from '../testing/git-fixture';
import type { PeerSource } from '../types/peer-source.type';
import { describeSource } from './describe-source';
import { exportTree } from './export-tree';
import { loadPeerSnapshot } from './load-peer-snapshot';
import { parsePeerSource } from './parse-peer-source';
import { readDeployedRecord } from './read-deployed-record';
import { recordDeployed } from './record-deployed';

/**
 * «Золотая» таблица источников снимка: разбор строки источника на границах
 * (`#`/`:`/`@` в начале и в конце), точный текст каждого отказа добычи (метка
 * источника, вызов git, его код и вывод), нормализация пути для git, проброс
 * потолка времени, временные каталоги убираются и не создаются в каталоге
 * процесса. Ожидания записаны с собранного пакета и прочитаны глазами.
 */
const root = mkdtempSync(join(tmpdir(), 'contracts-sources-golden-'));
const repo = join(root, 'repo');
let sha = '';
beforeAll(() => {
  gitFixture.init(repo);
  sha = gitFixture.commit(
    repo,
    {
      'dir/s.json': serializeSnapshot(
        createSnapshot({ reads: [defineContract({ name: 'm', version: '1.0.0', schema: z.object({}) })] }),
      ),
      'bad.json': 'not json',
    },
    'снимок',
  );
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
const outcome = (run: () => unknown): unknown => {
  try {
    const result = run();
    return typeof result === 'object' && result !== null && 'contracts' in result
      ? `loaded:${Object.keys((result as { contracts: object }).contracts).join(',')}`
      : result;
  } catch (error) {
    return error instanceof Error
      ? `${error.name}: ${error.message.split(root).join('<root>').split(sha).join('<sha>')}`
      : String(error);
  }
};
const UNAVAILABLE = 'PeerSnapshotUnavailableError: снимок другой стороны не добыт';
// Временные каталоги библиотеки — отслеживаются по вызовам mkdtempSync, а не сравнением общего tmpdir
// (соседние спеки в других воркерах создают свои), и не подменой TMPDIR (jest даёт спеке копию
// process.env, os.tmpdir её не видит). Возвращает созданные за вызов каталоги, которые остались на диске.
const leftAfter = (run: () => void): string[] => {
  const created: string[] = [];
  const real = fs.mkdtempSync;
  const spy = jest.spyOn(fs, 'mkdtempSync').mockImplementation(((prefix: string, options?: unknown) => {
    const dir = real(prefix, options as BufferEncoding);
    created.push(dir);
    return dir;
  }) as typeof fs.mkdtempSync);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  expect(created.length).toBeGreaterThan(0);
  return created.filter((dir) => fs.existsSync(dir));
};

describe('parsePeerSource и describeSource', () => {
  const where = 'ожидалось <где>#<ref>:<путь>';
  const deployed = 'ожидалось deployed:<запись>@<репозиторий>';
  it.each<readonly [string, unknown]>([
    ['git:#r:p', `${UNAVAILABLE} (git:#r:p): ${where}`],
    ['git:repo#ref:path', { kind: 'git', repo: 'repo', ref: 'ref', path: 'path' }],
    ['git:repo#:path', `${UNAVAILABLE} (git:repo#:path): ${where}`],
    ['git:repo#ref:', `${UNAVAILABLE} (git:repo#ref:): ${where}`],
    ['git:repo#ref', `${UNAVAILABLE} (git:repo#ref): ${where}`],
    ['git:repo', `${UNAVAILABLE} (git:repo): ${where}`],
    ['clone:u#r:p', { kind: 'clone', url: 'u', ref: 'r', path: 'p' }],
    ['deployed:@repo', `${UNAVAILABLE} (deployed:@repo): ${deployed}`],
    ['deployed:rec@', `${UNAVAILABLE} (deployed:rec@): ${deployed}`],
    ['deployed:rec', `${UNAVAILABLE} (deployed:rec): ${deployed}`],
    ['deployed:r@x', { kind: 'deployed', record: 'r', repo: 'x' }],
    ['file:', `${UNAVAILABLE} (file:): пустой путь`],
    ['', `${UNAVAILABLE} (): пустой путь`],
    ['file:a.json', { kind: 'file', path: 'a.json' }],
    ['x/file:', { kind: 'file', path: 'x/file:' }],
  ])('%j', (text, expected) => {
    expect(outcome(() => parsePeerSource(text))).toEqual(expected);
  });

  it('метка источника — по виду, и разбирается обратно в тот же источник', () => {
    const sources: PeerSource[] = [
      { kind: 'file', path: 'a' },
      { kind: 'git', repo: 'r', ref: 'v', path: 'p' },
      { kind: 'clone', url: 'u', ref: 'v', path: 'p' },
      { kind: 'deployed', record: 'rec', repo: 'r' },
    ];
    expect(sources.map(describeSource)).toEqual(['file:a', 'git:r#v:p', 'clone:u#v:p', 'deployed:rec@r']);
    expect(sources.map((source) => parsePeerSource(describeSource(source)))).toEqual(sources);
  });
});

describe('loadPeerSnapshot: добыча и отказы', () => {
  const git = (path: string, options: { readonly timeoutMs?: number } = {}): unknown =>
    outcome(() => loadPeerSnapshot({ kind: 'git', repo, ref: sha, path }, options));
  const label = (path: string): string => `${UNAVAILABLE} (git:<root>/repo#<sha>:${path})`;

  it('путь для git: ведущее ./ снимается, обратная косая — прямая; ./ внутри пути — как есть (git его отвергает)', () => {
    expect(git('./dir/s.json')).toBe('loaded:m');
    expect(git('dir\\s.json')).toBe('loaded:m');
    expect(git('dir/./s.json')).toBe(
      `${label('dir/./s.json')}: git -C <root>/repo show --end-of-options <sha>:dir/./s.json завершился с кодом 128: fatal: path 'dir/./s.json' exists on disk, but not in '<sha>'`,
    );
  });

  it('git завершился с ошибкой — вызов, код и вывод git без хвостового перевода строки', () => {
    expect(git('missing.json')).toBe(
      `${label('missing.json')}: git -C <root>/repo show --end-of-options <sha>:missing.json завершился с кодом 128: fatal: path 'missing.json' does not exist in '<sha>'`,
    );
  });

  it('не снимок — отказ добычи с причиной разбора', () => {
    expect(git('bad.json')).toBe(
      `${label('bad.json')}: git:<root>/repo#<sha>:bad.json: не снимок контрактов: не JSON (Unexpected token 'o', "not json" is not valid JSON)`,
    );
  });

  it('потолок времени доходит до git: 1 мс — отказ с полным вызовом', () => {
    // Потолок — на всю добычу: исчерпан до вызова git — отказ бюджета, во время — ETIMEDOUT git; оба — отказ.
    const exhausted = (prefix: string, call: string): RegExp =>
      new RegExp(
        `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (?:${call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: spawnSync git ETIMEDOUT|потолок времени 1 мс на добычу снимка исчерпан)$`,
      );
    expect(git('dir/s.json', { timeoutMs: 1 })).toMatch(
      exhausted(label('dir/s.json'), 'git -C <root>/repo show --end-of-options <sha>:dir/s.json'),
    );
    let cloned: unknown;
    const left = leftAfter(() => {
      cloned = outcome(() =>
        loadPeerSnapshot(
          { kind: 'clone', url: `file://${repo}`, ref: 'main', path: 'dir/s.json' },
          { timeoutMs: 1 },
        ),
      );
    });
    expect(cloned).toMatch(
      exhausted(`${UNAVAILABLE} (clone:file://<root>/repo#main:dir/s.json)`, 'git init -q'),
    );
    expect(left).toEqual([]);
  });

  it('аргументы git, начинающиеся с «-» или пустые, — отказ с названием аргумента', () => {
    const option = 'начинается с «-»: git принял бы его за опцию';
    expect(outcome(() => loadPeerSnapshot({ kind: 'git', repo, ref: '-x', path: 'p' }))).toBe(
      `${UNAVAILABLE} (git:<root>/repo#-x:p): ревизия "-x" ${option}`,
    );
    expect(outcome(() => loadPeerSnapshot({ kind: 'git', repo, ref: '', path: 'p' }))).toBe(
      `${UNAVAILABLE} (git:<root>/repo#:p): ревизия: пустое значение`,
    );
    expect(outcome(() => loadPeerSnapshot({ kind: 'git', repo, ref: sha, path: '-p' }))).toBe(
      `${label('-p')}: путь "-p" ${option}`,
    );
    expect(outcome(() => loadPeerSnapshot({ kind: 'clone', url: '-u', ref: sha, path: 'p' }))).toBe(
      `${UNAVAILABLE} (clone:-u#<sha>:p): адрес репозитория "-u" ${option}`,
    );
    expect(outcome(() => loadPeerSnapshot({ kind: 'clone', url: 'file:///x', ref: '-r', path: 'p' }))).toBe(
      `${UNAVAILABLE} (clone:file:///x#-r:p): ревизия "-r" ${option}`,
    );
    expect(
      outcome(() => loadPeerSnapshot({ kind: 'clone', url: 'file:///x', ref: 'main', path: '-p' })),
    ).toBe(`${UNAVAILABLE} (clone:file:///x#main:-p): путь "-p" ${option}`);
  });

  it('нет репозитория, файла, снимка в каталоге — названо, чего нет', () => {
    expect(
      outcome(() => loadPeerSnapshot({ kind: 'git', repo: join(root, 'none'), ref: sha, path: 'p' })),
    ).toBe(`${UNAVAILABLE} (git:<root>/none#<sha>:p): нет репозитория <root>/none`);
    expect(outcome(() => loadPeerSnapshot({ kind: 'file', path: join(root, 'none.json') }))).toBe(
      `${UNAVAILABLE} (file:<root>/none.json): нет файла или каталога`,
    );
    expect(outcome(() => loadPeerSnapshot({ kind: 'file', path: repo }))).toBe(
      `${UNAVAILABLE} (file:<root>/repo): в каталоге нет contracts.snapshot.json`,
    );
  });

  it('удалённый клон — во временном каталоге, а не в каталоге процесса; каталог убран', () => {
    const cwd = mkdtempSync(join(root, 'cwd-'));
    const previous = process.cwd();
    let cloned: unknown;
    process.chdir(cwd);
    let left: string[];
    try {
      left = leftAfter(() => {
        cloned = outcome(() =>
          loadPeerSnapshot({ kind: 'clone', url: `file://${repo}`, ref: 'main', path: 'dir/s.json' }),
        );
      });
    } finally {
      process.chdir(previous);
    }
    expect(cloned).toBe('loaded:m');
    expect(existsSync(join(cwd, '.git'))).toBe(false);
    expect(left).toEqual([]);
  });
});

describe('exportTree', () => {
  it('отказы названы ревизией и репозиторием; дерево убирает dispose', () => {
    expect(outcome(() => exportTree(join(root, 'none'), 'main'))).toBe(
      `${UNAVAILABLE} (git:<root>/none#main): нет репозитория <root>/none`,
    );
    expect(outcome(() => exportTree(repo, '-x'))).toBe(
      `${UNAVAILABLE} (git:<root>/repo#-x): ревизия "-x" начинается с «-»: git принял бы его за опцию`,
    );
    expect(outcome(() => exportTree(repo, 'nope'))).toBe(
      `${UNAVAILABLE} (git:<root>/repo#nope): git -C <root>/repo archive --format=tar --end-of-options nope завершился с кодом 128: fatal: not a valid object name: nope`,
    );
    const tree = exportTree(repo, sha);
    expect(existsSync(join(tree.dir, 'dir', 's.json'))).toBe(true);
    tree.dispose();
    expect(existsSync(tree.dir)).toBe(false);
    // Повторный dispose — не ошибка: уборка в finally вызывающего может сработать дважды.
    expect(() => tree.dispose()).not.toThrow();
  });

  it('tar упал — отказ с его выводом, временный каталог убран', () => {
    const bin = join(root, 'fake-tar');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'tar'),
      '#!/bin/sh\necho "  tar сломан: длинная причина, заведомо больше шестидесяти четырёх байт вывода  " >&2\nexit 2\n',
    );
    chmodSync(join(bin, 'tar'), 0o755);
    let exported: unknown;
    // tar подменяется на уровне вызова: PATH спеки (копия process.env) до spawnSync не доходит.
    const realSpawn = childProcess.spawnSync;
    const spawn = jest
      .spyOn(childProcess, 'spawnSync')
      .mockImplementation(((command: string, args: readonly string[], options: object) =>
        realSpawn(
          command === 'tar' ? join(bin, 'tar') : command,
          args,
          options,
        )) as typeof childProcess.spawnSync);
    let left: string[];
    try {
      left = leftAfter(() => {
        exported = outcome(() => exportTree(repo, sha));
      });
    } finally {
      spawn.mockRestore();
    }
    expect(exported).toBe(
      `${UNAVAILABLE} (git:<root>/repo#<sha>): tar -x: tar сломан: длинная причина, заведомо больше шестидесяти четырёх байт вывода`,
    );
    expect(left).toEqual([]);
  });
});

describe('запись о развёрнутой ревизии', () => {
  const FORMAT = 'contracts-deployed/1';
  const file = (): string => join(root, 'rec.json');
  const read = (body: unknown): unknown => {
    writeFileSync(file(), typeof body === 'string' ? body : JSON.stringify(body));
    return outcome(() => readDeployedRecord(file()));
  };
  const label = `${UNAVAILABLE} (deployed:<root>/rec.json)`;

  it('чтение: каждый отказ с причиной; хэш — ровно 40 или 64 шестнадцатеричных знака', () => {
    expect(outcome(() => readDeployedRecord(join(root, 'none.json')))).toBe(
      `${UNAVAILABLE} (deployed:<root>/none.json): нет записи о развёрнутой ревизии`,
    );
    expect(read('{')).toBe(
      `${label}: не JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)`,
    );
    expect(read({ format: 'x' })).toBe(`${label}: поле format "x", ожидалось ${FORMAT}`);
    const record = (ref: unknown) => ({ format: FORMAT, ref, snapshotPath: 's', peer: 'p' });
    for (const ref of ['abc', `x${sha}`, `${sha}x`, 'a']) {
      expect(read(record(ref))).toBe(
        `${label}: ревизия ${JSON.stringify(ref).split(sha).join('<sha>')} — не полный хэш коммита`,
      );
    }
    expect(read(record(1))).toBe(`${label}: ревизия 1 — не полный хэш коммита`);
    expect(read(record('a'.repeat(64)))).toEqual(record('a'.repeat(64)));
    expect(read(record(sha))).toEqual(record(sha));
    for (const broken of [
      { format: FORMAT, ref: sha, peer: 'p' },
      { format: FORMAT, ref: sha, snapshotPath: '', peer: 'p' },
      { format: FORMAT, ref: sha, snapshotPath: 's' },
    ]) {
      expect(read(broken)).toBe(`${label}: нет snapshotPath или peer`);
    }
  });

  it('запись: ревизия — полный хэш, peer и путь не пустые', () => {
    const write = (record: { peer: string; ref: string; snapshotPath: string }): unknown =>
      outcome(() => recordDeployed(join(root, 'w', 'd.json'), record));
    for (const ref of ['abc', `x${sha}`, `${sha}x`, 'a']) {
      expect(write({ peer: 'p', ref, snapshotPath: 's' })).toBe(
        `ContractDefinitionError: p (ref): ревизия ${JSON.stringify(ref).split(sha).join('<sha>')} — не полный хэш коммита`,
      );
    }
    expect(write({ peer: 'p', ref: 'a'.repeat(64), snapshotPath: 's' })).toEqual({
      format: FORMAT,
      peer: 'p',
      ref: 'a'.repeat(64),
      snapshotPath: 's',
    });
    expect(write({ peer: 'p', ref: sha, snapshotPath: '' })).toBe(
      'ContractDefinitionError: p: пустой peer или snapshotPath',
    );
    expect(write({ peer: '', ref: sha, snapshotPath: 's' })).toBe(
      'ContractDefinitionError: : пустой peer или snapshotPath',
    );
  });
});
