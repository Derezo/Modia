import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseBattleTerminalOutboxRedriveArgs,
  runBattleTerminalOutboxRedriveCli
} from '../../scripts/battle-terminal-outbox-redrive.js';

function outputCollector() {
  let value = '';
  return {
    stream: { write: chunk => { value += chunk; } },
    read: () => value
  };
}

describe('battle terminal outbox redrive operator command', () => {
  it('requires an exact event confirmation plus actor and reason', () => {
    assert.throws(
      () => parseBattleTerminalOutboxRedriveArgs([]),
      /--event-key is required/
    );
    assert.throws(
      () => parseBattleTerminalOutboxRedriveArgs([
        '--event-key=battle:42:quest.progress',
        '--confirm=battle:43:quest.progress',
        '--actor=ops',
        '--reason=provider recovered'
      ]),
      /--confirm must exactly match --event-key/
    );

    assert.deepEqual(
      parseBattleTerminalOutboxRedriveArgs([
        '--event-key=battle:42:quest.progress',
        '--confirm=battle:42:quest.progress',
        '--actor=ops@example.test',
        '--reason=INC-42 provider recovered'
      ]),
      {
        help: false,
        eventKey: 'battle:42:quest.progress',
        confirm: 'battle:42:quest.progress',
        actor: 'ops@example.test',
        reason: 'INC-42 provider recovered'
      }
    );
  });

  it('passes explicit audit data to the redrive service and closes the pool', async () => {
    const output = outputCollector();
    let closed = false;
    const result = await runBattleTerminalOutboxRedriveCli({
      argv: [
        '--event-key=battle:42:quest.progress',
        '--confirm=battle:42:quest.progress',
        '--actor=ops@example.test',
        '--reason=INC-42 provider recovered'
      ],
      stdout: output.stream,
      dependencies: {
        outbox: {
          async redriveExhausted(eventKey, audit) {
            assert.equal(eventKey, 'battle:42:quest.progress');
            assert.deepEqual(audit, {
              actor: 'ops@example.test',
              reason: 'INC-42 provider recovered'
            });
            return {
              event: {
                eventKey,
                attempts: 0,
                nextAttemptAt: new Date('2026-07-28T12:05:00.000Z')
              },
              audit: {
                id: 7,
                ...audit,
                previousAttempts: 5,
                previousLastError: 'provider unavailable',
                redrivenAt: new Date('2026-07-28T12:05:00.000Z')
              }
            };
          }
        },
        close: async () => { closed = true; }
      }
    });

    assert.equal(result.mode, 'redrive');
    assert.equal(closed, true);
    const written = JSON.parse(output.read());
    assert.equal(written.event, 'battle_terminal_outbox_redriven');
    assert.equal(written.eventKey, 'battle:42:quest.progress');
    assert.equal(written.audit.previousAttempts, 5);
  });

  it('closes the pool when redrive is rejected', async () => {
    let closed = false;

    await assert.rejects(
      runBattleTerminalOutboxRedriveCli({
        argv: [
          '--event-key=battle:42:quest.progress',
          '--confirm=battle:42:quest.progress',
          '--actor=ops',
          '--reason=provider recovered'
        ],
        stdout: outputCollector().stream,
        dependencies: {
          outbox: {
            async redriveExhausted() {
              throw new Error('event is already processed');
            }
          },
          close: async () => { closed = true; }
        }
      }),
      /already processed/
    );
    assert.equal(closed, true);
  });
});
