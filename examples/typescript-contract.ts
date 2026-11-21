// A side that keeps the contract as a TypeScript interface (no Zod): the shape
// and the wire constants are read by the installed TypeScript compiler.
import { createSnapshot } from '@hoshinotatsuya/contracts';
import { typeScriptContract } from '@hoshinotatsuya/contracts/typescript';

const SendEmail = typeScriptContract({
  name: 'send-email',
  version: '1.3.0',
  file: 'src/queue/send-email.interface.ts',
  type: 'SendEmailJob',
  wire: { file: 'src/queue/queues.constant.ts', names: ['QUEUES'] },
  tsconfig: 'tsconfig.json', // path aliases, moduleResolution
});

export const snapshot = () => createSnapshot({ reads: [SendEmail] });
