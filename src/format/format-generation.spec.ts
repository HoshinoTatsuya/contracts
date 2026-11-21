import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTRACT_FORMAT } from '../constants/contract-format.constant';
import { parseSnapshot } from '../snapshot/parse-snapshot';
import { readDeployedRecord } from '../sources/read-deployed-record';
import { formatGeneration } from './format-generation';

/**
 * Тег формата: текущий без префикса, а документы до 0.4.0 — с префиксом
 * пространства имён того же поколения. Читаются оба; всё остальное — отказ,
 * чтобы снисхождение к префиксу не стало «любая строка с нужным хвостом».
 */
describe('тег формата документа', () => {
  const SNAPSHOT = CONTRACT_FORMAT.SNAPSHOT;

  it.each([
    ['contracts-snapshot/2', 2],
    ['contracts-snapshot/1', 1],
    ['acme-contracts-snapshot/2', 2],
    ['acme-corp-contracts-snapshot/2', 2],
    ['a1-contracts-snapshot/1', 1],
  ])('%s — поколение %s', (format, generation) => {
    expect(formatGeneration(format, SNAPSHOT)).toBe(generation);
  });

  it.each([
    ['чужая база', 'contracts-deployed/1'],
    ['слитный префикс', 'acmecontracts-snapshot/2'],
    ['пустой префикс', '-contracts-snapshot/2'],
    ['префикс с заглавной', 'Acme-contracts-snapshot/2'],
    ['префикс с двойным дефисом', 'acme--contracts-snapshot/2'],
    ['префикс с цифры', '1acme-contracts-snapshot/2'],
    ['хвост после базы', 'contracts-snapshot-x/2'],
    ['без поколения', 'contracts-snapshot'],
    ['пустое поколение', 'contracts-snapshot/'],
    ['поколение с нуля', 'contracts-snapshot/02'],
    ['поколение не число', 'contracts-snapshot/2a'],
    ['пустая строка', ''],
    ['не строка', 2],
    ['нет значения', undefined],
  ])('%s (%j) — не тег этого формата', (_name, format) => {
    expect(formatGeneration(format, SNAPSHOT)).toBeUndefined();
  });

  it('снимок с прежним тегом читается, и разобранный документ несёт текущий тег', () => {
    for (const format of [SNAPSHOT, 'acme-contracts-snapshot/2']) {
      expect(parseSnapshot(JSON.stringify({ format, contracts: {} }), 'peer')).toEqual({
        format: SNAPSHOT,
        contracts: {},
      });
    }
  });

  it('прежний тег поколения /1 — отказ с указанием пересобрать, чужое поколение — отказ формата', () => {
    expect(() =>
      parseSnapshot(JSON.stringify({ format: 'acme-contracts-snapshot/1', contracts: {} }), 'peer'),
    ).toThrow(/формата \/1 .*пересоберите/);
    expect(() =>
      parseSnapshot(JSON.stringify({ format: 'acme-contracts-snapshot/3', contracts: {} }), 'peer'),
    ).toThrow(`поле format "acme-contracts-snapshot/3", ожидалось "${SNAPSHOT}"`);
    expect(() =>
      parseSnapshot(JSON.stringify({ format: CONTRACT_FORMAT.DEPLOYED, contracts: {} }), 'peer'),
    ).toThrow(`ожидалось "${SNAPSHOT}"`);
  });

  it('запись о развёрнутой ревизии с прежним тегом читается, с чужим — отказ', () => {
    const root = mkdtempSync(join(tmpdir(), 'contracts-format-'));
    try {
      const file = join(root, 'rec.json');
      const record = { ref: 'a'.repeat(40), snapshotPath: 's', peer: 'p' };
      for (const format of [CONTRACT_FORMAT.DEPLOYED, 'acme-contracts-deployed/1']) {
        writeFileSync(file, JSON.stringify({ format, ...record }));
        expect(readDeployedRecord(file)).toEqual({ format, ...record });
      }
      for (const format of ['acme-contracts-deployed/2', SNAPSHOT, 'acmecontracts-deployed/1']) {
        writeFileSync(file, JSON.stringify({ format, ...record }));
        expect(() => readDeployedRecord(file)).toThrow(`поле format ${JSON.stringify(format)}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
