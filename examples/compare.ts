// The same checks as the CLI, from code: load the other side's snapshot,
// compare, accept known differences with a reason.
import {
  applyKnown,
  compareSnapshots,
  formatVerdict,
  loadPeerSnapshot,
  PeerSnapshotUnavailableError,
  type SnapshotDocument,
} from '@hoshinotatsuya/contracts';

import { snapshot } from './contracts';

export function checkAgainstPeer(): boolean {
  let peer: SnapshotDocument;
  try {
    peer = loadPeerSnapshot(
      { kind: 'git', repo: '../mailer', ref: 'origin/HEAD', path: 'contracts.snapshot.json' },
      { timeoutMs: 60_000 },
    );
  } catch (error) {
    if (error instanceof PeerSnapshotUnavailableError) {
      console.error(`NOT CHECKED: ${error.message}`); // a failure, never a skip
    }
    throw error;
  }
  const verdict = compareSnapshots(snapshot(), peer, { mode: 'compatible' });
  const known = applyKnown(verdict, {
    'send-email field-unread traceId': 'the mailer starts reading traceId in 1.4; until then it drops it',
  });
  console.log(formatVerdict(known.verdict));
  // A known difference that no longer matches anything is stale and fails the check too.
  return known.verdict.ok && known.stale.length === 0 && known.unexplained.length === 0;
}
