import type { ContractDefinition } from '../types/contract-definition.type';
import type { InputOf } from '../types/input-of.type';
import type { OutputOf } from '../types/output-of.type';
import type { ZodLike } from '../types/zod-like.type';
import { Contract } from './contract';

/**
 * Объявить контракт: имя, версия, схема Zod 4, значения на проводе.
 *
 * ```ts
 * export const ScanTask = defineContract({
 *   name: 'scan-task',
 *   version: '1.3.0',
 *   schema: z.object({ taskId: z.string(), hosts: z.array(z.string()) }),
 *   wire: { queue: 'scan-tasks', lockKey: (taskId: string) => `scan:lock:${taskId}` },
 * });
 *
 * queue.add(ScanTask.wire.queue, ScanTask.write({ taskId, hosts }));
 * const { data } = ScanTask.read(job.data);
 * ```
 */
export function defineContract<S extends ZodLike, const W = undefined>(
  definition: ContractDefinition<S, W>,
): Contract<OutputOf<S>, InputOf<S>, W> {
  return new Contract<OutputOf<S>, InputOf<S>, W>(definition);
}
