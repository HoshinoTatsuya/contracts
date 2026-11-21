// The Jest gate in the consumer's test suite: the committed snapshot is up to
// date, the change is compatible with the previous snapshot of this side, and
// the deployed revision of the other side can still talk to this one.
import { join } from 'node:path';

import { contractsGate } from '@hoshinotatsuya/contracts/jest';

import { EmailSent, SendEmail, snapshot } from './contracts';

contractsGate({
  root: join(__dirname, '..'),
  snapshot,
  committed: 'contracts.snapshot.json',
  minContracts: 2,
  previous: { source: { kind: 'git', repo: '.', ref: 'origin/HEAD', path: 'contracts.snapshot.json' } },
  peers: [
    {
      name: 'mailer',
      source: { kind: 'deployed', record: 'contracts/mailer.deployed.json', repo: '../mailer' },
      known: {
        'send-email field-unread traceId': 'the mailer starts reading traceId in 1.4; until then it drops it',
      },
    },
  ],
  runtime: [SendEmail, EmailSent],
});
