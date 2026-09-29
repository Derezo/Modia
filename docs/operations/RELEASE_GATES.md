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

## Standing

- **External uptime monitoring for `https://modia.mittonvillage.com/api/health`.** The
  2026-05-07 outage ran 8 days undetected. `lsd` now installs the `pm2-modia` systemd unit
  on every deploy, but nothing alerts on downtime.
  *Owner:* operator.
