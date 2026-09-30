# Release Gates

Operational gates owned by a person, not by code. Check each one before tagging and
deploying the release it names. Code defects live in `FINDINGS_OUTSIDE_SCOPE.md`.

## 0.5.2

- **Dry-run migrations 064 and 065 against a production snapshot.** 064 Part 3 rewrites
  exploit-created `npc_shop_inventory` rows, and 065 changes marketplace FKs and backfills
  listings. Both were verified only on dev data.
  *Owner:* operator. *How:* restore a recent prod dump locally, run `npm run db:migrate`,
  and spot-check `npc_shop_inventory` and `item_listings` counts before and after.
- **Deploy in a quiet window.** 065 and 066 take short `ACCESS EXCLUSIVE` locks on
  marketplace tables and on `users` and `characters`. They abort after a 5 s lock
  timeout rather than stalling the app; if a lock times out, re-run `npm run db:migrate`.
- **Tell players they will be signed out once.** Migration 067 deletes bcrypt-hashed
  refresh sessions when refresh tokens move to SHA-256 digests.
- **Confirm the regenerated art reaches production.** `frontend/public/assets/` is
  gitignored, so a fix to a generated image exists only on the machine that made it.
  0.5.2 points the castle menu back at `menu/coliseum`, whose old art was almost fully
  transparent (a blank slot in the menu); if production still serves the old file, the
  blank icon returns. `deploy.yaml` ships `frontend/dist`, built by `npm run build -w
  frontend` from whatever `public/assets/` holds where the build runs.
  *Owner:* operator. *How:* build from the workstation tree that has the regenerated
  assets (or copy them to the build host first), then open the castle menu on
  production and check the Coliseum icon is visible.
- **Run the new migrations 068 and 069.** 068 adds a one-party-leader-per-user index and
  069 a one-clan-per-user index (`uniq_clan_members_user`). Both repair duplicates first:
  068 moves extra slot-1 characters out of the formation, and 069 deletes all but one
  clan membership per user (keeping a leader row, then the earliest joined).
  *Owner:* operator. *How:* on the production snapshot from the first gate, run
  `SELECT user_id, COUNT(*) FROM clan_members GROUP BY user_id HAVING COUNT(*) > 1`
  before migrating; any rows listed are memberships 069 will delete.

## Standing

- **External uptime monitoring for `https://modia.mittonvillage.com/api/health`.** The
  2026-05-07 outage ran 8 days undetected. `lsd` now installs the `pm2-modia` systemd unit
  on every deploy, but nothing alerts on downtime.
  *Owner:* operator.
