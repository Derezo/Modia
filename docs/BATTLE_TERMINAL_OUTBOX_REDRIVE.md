# Battle Terminal Outbox Redrive

Use this runbook after `/api/health/ready` or `/api/health/metrics` reports an
exhausted battle terminal effect. Redrive is a recovery action, not a substitute
for diagnosing the handler failure.

## Safety boundary

The supported control is a local operator CLI; there is no redrive HTTP
endpoint. Running it requires production shell access and the database
credentials available to the API process. The command also requires:

- the exact stable event key twice, to guard against targeting a typo;
- a durable operator or change-ticket label;
- a durable investigation/remediation reason.

The service locks the target row and fails closed unless it is unprocessed and
has reached the configured maximum attempts. An unexpired final-attempt claim
is rejected; wait for the claim lease to expire before retrying the command.
The row reset and immutable audit insert commit as one database statement, so
concurrent operators cannot both redrive the same exhausted generation.

Never manually update the outbox, delete a receipt, or reduce `attempts`.
Redrive retains the original `event_key` and does not modify effect receipts,
so replay continues through the handlers' existing idempotency boundary.

## Procedure

1. Apply migrations normally and verify
   `056_battle_terminal_outbox_redrives.sql` is present in the migration log.
2. Identify the exact event key from the worker exhaustion alert or structured
   `BattleTerminalOutbox` error log.
3. Resolve or mitigate the recorded handler failure.
4. From the `api` directory, run:

   ```sh
   npm run battle:outbox:redrive -- \
     --event-key='battle:42:battle.progression.v1' \
     --confirm='battle:42:battle.progression.v1' \
     --actor='operator@example.com / INC-42' \
     --reason='Quest provider recovered and payload validation was confirmed'
   ```

5. Retain the JSON result in the incident record. A successful response is
   named `battle_terminal_outbox_redriven`, reports `attempts: 0`, and includes
   the immutable audit identifier and database timestamp.
6. Watch `/api/health/metrics`. The worker should claim the event immediately;
   confirm the exhausted count falls and no new terminal-effect error appears.
   A replay of an already committed handler effect returns its existing receipt
   result instead of repeating the mutation.

## Rejections

- `does not exist`: re-check the exact event key from the alert.
- `is already processed`: no recovery action is needed.
- `is not exhausted`: allow the normal retry schedule to continue.
- `still has an active delivery claim`: wait at least one configured claim
  lease and re-check worker health before retrying.

If the event exhausts again, investigate the new `last_error`. A later redrive
creates another audit row and never overwrites earlier operator history.
