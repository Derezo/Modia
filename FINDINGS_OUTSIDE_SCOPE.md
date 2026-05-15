# Findings Outside Scope

Issues identified during work but deliberately deferred. When closed, **delete the entry** — git history is the audit trail.

---

## Open

### PM2 daemon does not auto-recover; 8-day silent outage on 2026-05-07

- **Status:** Open
- **Surfaced:** 2026-05-15 (while diagnosing 502s on `/api/characters/preview`)
- **Reproducer:** SSH session that started PM2 ends → `SIGHUP` propagates → PM2 daemon exits → no systemd unit brings it back. Last incident: `pm2.log` shows `2026-05-07T06:20:46: pm2 has been killed by signal`, daemon never restarted until manual `lsd deploy` on 2026-05-15. The `modia` user has shell `/usr/sbin/nologin` and no `~/.config/systemd/user/pm2-modia.service` (or equivalent system unit) exists.
- **Why deferred:** Recovery was time-sensitive; root-cause fix likely belongs in `lsd` (which owns the PM2 lifecycle on this VPS), not in this repo. Filing here so it surfaces in `lsd`'s next iteration.
- **Why it matters:** Production was 502-ing for 8 days with no alerting. The next SIGHUP (reboot, lsd reconnect, etc.) will repeat this.
- **Effort:** Low (add `pm2 startup` + persisted systemd unit during `lsd deploy`'s pm2 phase, or have `lsd` install a system-level unit that runs `pm2 resurrect` on boot).
- **References:**
  - `/home/modia/.pm2/pm2.log` on mittonvillage.com
  - `deploy.yaml` Phase 5b — `pm2[modia-api] script=api/src/index.js mode=fork(singleton)`
  - `docs/DEPLOYMENT.md`
- **Companion ask:** Consider also adding external uptime monitoring against `https://modia.mittonvillage.com/api/health` so the next outage is detected in minutes, not days. (Out of scope for this repo; tracking here as a pointer.)
