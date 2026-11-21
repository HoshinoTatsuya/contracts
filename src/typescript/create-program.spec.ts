import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TypeScriptCompilerError } from '../errors/type-script-compiler.error';
import type { TypeScriptProgram } from '../types/type-script-program.type';
import { createProgram } from './create-program';
import { findWireLiterals } from './find-wire-literals';
import { shapeFromTypeScript } from './shape-from-type-script';
import { COMPILERS } from './testing/compilers.fixture';
import { typeScriptContract } from './type-script-contract';
import { wireFromTypeScript } from './wire-from-type-script';

/**
 * Жизнь программы: у TS 7 программа — процесс компилятора, и каждый вызов,
 * собравший программу сам, обязан его остановить; закрытая программа — отказ,
 * а не `TypeError` из канала к мёртвому процессу. Утечка процесса видна
 * числом дочерних процессов jest-воркера, а не временем.
 */
const dir = mkdtempSync(join(tmpdir(), 'contracts-create-program-'));
const file = join(dir, 'dto.ts');
writeFileSync(file, "export interface Dto { id: string }\nexport const Q = { a: 'q:a' } as const;\n");
writeFileSync(join(dir, 'use.ts'), "export const x = 'q:a';\n");
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Дочерние процессы этого воркера (pgrep не считает себя); снятый процесс уходит не мгновенно — ждём до 2 с. */
const children = (expected?: number): number => {
  let count = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const listed = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).stdout;
    count = listed.split('\n').filter(Boolean).length;
    if (expected === undefined || count === expected) {
      return count;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return count;
};

describe.each(COMPILERS)('программа TypeScript — %s (%s)', (compiler, version) => {
  const native = version.startsWith('7.');

  it('у TS 7 программа — процесс: createProgram добавляет один, dispose снимает; повторный dispose — без действия', () => {
    const before = children();
    const program = createProgram([file], { compiler });
    expect(children(before + (native ? 1 : 0))).toBe(before + (native ? 1 : 0));
    program.dispose();
    program.dispose();
    expect(children(before)).toBe(before);
  });

  it('вызовы, собравшие программу сами, не оставляют процессов — и при отказе разбора тоже', () => {
    const before = children();
    shapeFromTypeScript({ file, type: 'Dto', compiler });
    wireFromTypeScript({ file, names: ['Q'], compiler });
    expect(() => shapeFromTypeScript({ file, type: 'Missing', compiler })).toThrow('объявление не найдено');
    typeScriptContract({
      name: 'c',
      version: '1.0.0',
      file,
      type: 'Dto',
      wire: { file, names: ['Q'] },
      compiler,
    });
    expect(findWireLiterals({ root: dir, values: ['q:a'], declaredIn: ['dto.ts'], compiler })).toEqual({
      files: 1,
      hits: [{ file: 'use.ts', line: 1, value: 'q:a' }],
    });
    expect(children(before)).toBe(before);
  });

  it('закрытая программа — отказ с причиной, а не TypeError из канала к процессу', () => {
    const program = createProgram([file], { compiler });
    program.dispose();
    expect(() => shapeFromTypeScript({ file, type: 'Dto', program })).toThrow(
      new TypeScriptCompilerError('программа TypeScript уже закрыта (dispose)'),
    );
  });

  it('строка вместо опций — путь к tsconfig, как до 0.3.0', () => {
    writeFileSync(join(dir, 'bad.json'), '{ "compilerOptions": ');
    expect(() => createProgram([file], join(dir, 'bad.json'))).toThrow(
      `tsconfig (${join(dir, 'bad.json')}): Expression expected.`,
    );
    expect(() => createProgram([file], { tsconfig: join(dir, 'missing.json'), compiler })).toThrow(
      `tsconfig (${join(dir, 'missing.json')}): Cannot read file '${join(dir, 'missing.json')}'.`,
    );
  });
});

describe('программа не из createProgram', () => {
  it('подделка с compiler и dispose — отказ: внутренности компилятора берутся только у своих программ', () => {
    const fake: TypeScriptProgram = {
      compiler: { version: '5.9.3', api: 'classic', directory: '/' },
      dispose: () => undefined,
    };
    expect(() => shapeFromTypeScript({ file, type: 'Dto', program: fake })).toThrow(TypeScriptCompilerError);
  });

  it('пакет компилятора по имени, которого нет, — отказ «не найден»', () => {
    expect(() => createProgram([file], { compiler: 'typescript-nope' })).toThrow(
      /^пакет typescript-nope не найден от /,
    );
  });
});
