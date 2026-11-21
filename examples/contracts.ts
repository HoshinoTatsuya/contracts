// Quick start: one contract, the writer side and the reader side, and the
// snapshot module that the CLI and the Jest gate load.
import { createSnapshot, defineContract } from '@hoshinotatsuya/contracts';
import { z } from 'zod';

export const SendEmail = defineContract({
  name: 'send-email',
  version: '1.3.0',
  schema: z.object({
    jobId: z.string(),
    to: z.array(z.string()),
    priority: z.enum(['low', 'high']),
    traceId: z.string().optional(),
  }),
  wire: {
    queue: 'email-jobs',
    lockKey: (jobId: string) => `email:lock:${jobId}`, // in the snapshot: `email:lock:${0}`
    lockMs: 20 * 60_000,
  },
  examples: [{ jobId: 'j-1', to: ['a@example.com'], priority: 'low' }],
});

export const EmailSent = defineContract({
  name: 'email-sent',
  version: '1.0.0',
  schema: z.object({ jobId: z.string(), deliveredAt: z.string() }),
  wire: { queue: 'email-results' },
});

// This side writes `send-email` and reads `email-sent`; the other side has the
// same two contracts with the roles swapped.
export const snapshot = () => createSnapshot({ writes: [SendEmail], reads: [EmailSent] });
