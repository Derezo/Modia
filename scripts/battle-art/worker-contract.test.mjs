import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

import {
  CANONICAL_ROUTE_SKILL_READ_COMMAND,
  auditCanonicalParentRouteHandoffJsonl
} from './worker-contract.mjs';

const execFileAsync = promisify(execFile);

function parentHandoffEvidence(skillReadCommand) {
  return Buffer.from([
    JSON.stringify({
      type: 'thread.started',
      thread_id: 'portable-route-thread'
    }),
    JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'skill-read',
        type: 'command_execution',
        command: `/bin/bash -lc '${skillReadCommand}'`,
        status: 'completed',
        exit_code: 0
      }
    })
  ].join('\n') + '\n');
}

describe('battle-art Codex worker contract', () => {
  it('keeps live handoffs current-home exact but replays canonical home evidence',
    () => {
      const historicalCommand =
        '/bin/cat "/home/portable-reviewer/.codex/'
        + 'skills/.system/imagegen/SKILL.md"';
      assert.notEqual(historicalCommand, CANONICAL_ROUTE_SKILL_READ_COMMAND);
      const evidence = parentHandoffEvidence(historicalCommand);

      assert.throws(
        () => auditCanonicalParentRouteHandoffJsonl(evidence),
        /may execute only the canonical imagegen skill read/
      );
      assert.deepEqual(
        auditCanonicalParentRouteHandoffJsonl(evidence, {
          allowHistoricalSkillRead: true
        }),
        {
          threadId: 'portable-route-thread',
          commandCount: 1,
          observableImagegenInvocationCount: 0,
          skillReadCommand: historicalCommand
        }
      );
      const customCodexHomeCommand =
        '/bin/cat "/srv/portable-codex/'
        + 'skills/.system/imagegen/SKILL.md"';
      assert.equal(
        auditCanonicalParentRouteHandoffJsonl(
          parentHandoffEvidence(customCodexHomeCommand),
          { allowHistoricalSkillRead: true }
        ).skillReadCommand,
        customCodexHomeCommand,
        'an absolute canonical CODEX_HOME need not be named .codex'
      );
    });

  it('rejects noncanonical historical skill paths and command surfaces', () => {
    const canonicalHistoricalPath =
      '/home/portable-reviewer/.codex/skills/.system/imagegen/SKILL.md';
    for (const command of [
      '/bin/cat "/tmp/foreign/not-skills/.system/imagegen/SKILL.md"',
      '/bin/cat "/home/portable-reviewer/.codex/skills/.system/'
        + 'foreign/SKILL.md"',
      '/bin/cat "/home/portable-reviewer/.codex/skills/.system/'
        + 'imagegen/FOREIGN.md"',
      '/bin/cat "/home/portable-reviewer/.codex/skills/.system/imagegen/'
        + '../imagegen/SKILL.md"',
      `/bin/cat "${canonicalHistoricalPath}" /etc/hosts`,
      `/bin/cat "${canonicalHistoricalPath}"; /bin/true`,
      `/usr/bin/cat "${canonicalHistoricalPath}"`,
      `/bin/cat ${canonicalHistoricalPath}`
    ]) {
      assert.throws(
        () => auditCanonicalParentRouteHandoffJsonl(
          parentHandoffEvidence(command),
          { allowHistoricalSkillRead: true }
        ),
        /may execute only the canonical imagegen skill read/,
        `must reject historical skill read: ${command}`
      );
    }
  });

  it('audits the exact tracked end-e failure under another HOME and CODEX_HOME',
    async () => {
      const relativePath =
        'ai-image-metadata/battle-art/generated-artifacts/cave/'
        + 'cave-limestone-curved-passage-end-e/failures/'
        + '2adf19d488183e613297203f7859642b3095b1ae6059616bf820132f3b366074.json';
      const program = [
        "import { auditFailedRouteAttempt } from './scripts/battle-art/generate.mjs';",
        `const result = await auditFailedRouteAttempt({ relativePath: ${JSON.stringify(relativePath)} });`,
        'console.log(JSON.stringify({',
        '  fullHash: result.record.fullHash,',
        '  skillReadCommand: result.record.audit.skillRead.command',
        '}));'
      ].join('\n');
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['--input-type=module', '--eval', program],
        {
          cwd: new URL('../..', import.meta.url),
          env: {
            ...process.env,
            HOME: '/home/portable-auditor',
            CODEX_HOME: '/home/portable-auditor/.codex'
          }
        }
      );
      assert.equal(stderr, '');
      assert.deepEqual(JSON.parse(stdout), {
        fullHash:
          'sha256:2adf19d488183e613297203f7859642b3095b1ae6059616bf820132f3b366074',
        skillReadCommand:
          '/bin/cat "/home/eric/.codex/skills/.system/imagegen/SKILL.md"'
      });
    });
});
