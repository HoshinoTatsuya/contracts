import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/** Блоки ```ts README: первая строка — `// examples/<файл>.ts`, остальное — дословный кусок этого файла. */
const blocks = (readme: string): Array<{ readonly label: string; readonly body: string }> =>
  [...readFileSync(join(ROOT, readme), 'utf8').matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => {
    const [label = '', ...rest] = (match[1] ?? '').split('\n');
    return { label, body: rest.join('\n').trim() };
  });

/**
 * Код TypeScript в README — только файлы из examples/: их проверяет typecheck
 * против настоящего API и матрица потребителей против собранного пакета.
 * Блок, которого нет в примерах, мог бы разойтись с API незаметно.
 */
describe.each(['README.md', 'README.ru.md'])('%s цитирует examples/', (readme) => {
  const found = blocks(readme);

  it('блоков не меньше числа файлов примеров (выборка не выродилась)', () => {
    const files = readdirSync(join(ROOT, 'examples')).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(found.length).toBeGreaterThanOrEqual(files.length);
  });

  it('каждый блок назван файлом примера и дословно в нём есть', () => {
    const problems = found.flatMap(({ label, body }) => {
      const file = /^\/\/ (examples\/[a-z.-]+\.ts)$/.exec(label)?.[1];
      if (file === undefined || !existsSync(join(ROOT, file))) {
        return [`блок без файла примера: ${label}`];
      }
      return body !== '' && readFileSync(join(ROOT, file), 'utf8').includes(body)
        ? []
        : [`${file}: текст блока расходится с файлом`];
    });
    expect(problems).toEqual([]);
  });
});
