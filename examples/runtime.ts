// Runtime: the writer puts a versioned, schema-checked JSON copy on the wire;
// the reader parses it tolerantly and learns about fields it does not know.
import { ContractPayloadError, ContractVersionError } from '@hoshinotatsuya/contracts';

import { SendEmail } from './contracts';

/** Any queue client: the contract does not depend on one. */
declare const queue: { add(name: string, data: unknown): Promise<unknown> };

export async function enqueue(jobId: string, to: string[]): Promise<void> {
  // write() validates, adds `contractVersion: '1.3.0'` and returns the JSON copy.
  await queue.add(SendEmail.wire.queue, SendEmail.write({ jobId, to, priority: 'high' }));
}

export function handle(payload: unknown): void {
  try {
    const { data, version, unknownFields } = SendEmail.read(payload);
    console.log(data.jobId, data.to.length, version, unknownFields);
  } catch (error) {
    if (error instanceof ContractVersionError) {
      // A writer on another major version: refuse loudly, do not guess.
    } else if (error instanceof ContractPayloadError) {
      // Missing required field or wrong type; `error.message` lists the paths.
    }
    throw error;
  }
}
