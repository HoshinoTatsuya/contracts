import type { Finding } from '../types/finding.type';

/**
 * Стабильный адрес находки для списка известных расхождений: контракт, код и
 * путь, без текста — текст можно уточнять, не трогая список.
 */
export function findingKey(finding: Finding): string {
  return `${finding.contract} ${finding.code} ${finding.path === '' ? '(корень)' : finding.path}`;
}
