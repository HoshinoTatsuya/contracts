/** Ввод-вывод CLI: потоки и рабочий каталог (в спеках — подменяются). */
export interface CliIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}
