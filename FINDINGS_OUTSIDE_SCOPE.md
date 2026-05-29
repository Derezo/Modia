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

### Server-side charset validation missing on other user-named entities

- **Status:** Open
- **Surfaced:** 2026-05-28 (security audit pre-public; flagged by security-auditor re-scan)
- **Reproducer:** Create a clan/party/LFG post with a name containing `<img src=x onerror=...>`. It is stored (parameterized query, so no SQLi) and rendered. XSS is currently blocked at render because the client now `escapeHtml()`s these in `ClanTab.js`/`PartyTab.js`/`LFGTab.js`, but there is no server-side charset gate like the one added for character names.
- **Why deferred:** The render-side escaping (shipped in this audit) closes the actual XSS. Server-side validation is defense-in-depth and touches several create/update paths; out of scope for the pre-public hardening pass.
- **Why it matters:** Defense-in-depth — a future template that forgets to escape one of these would reintroduce stored XSS. Mirrors the character-name fix.
- **Effort:** Low–Medium. Reuse the pattern in `api/src/utils/nameValidation.js`; apply a (looser, allows longer text) validator to: clan name (`api/src/services/clanService.js` ~line 90), party name (`api/src/routes/party.js` ~line 225), LFG title/description (`api/src/routes/lfg.js` ~lines 149-150). Clan tags already validated (`api/src/routes/clans.js:54`).
- **References:** `api/src/utils/nameValidation.js` (reuse), `frontend/src/social/tabs/{ClanTab,PartyTab,LFGTab}.js` (render-side escaping already in place).

### Deferred LOW-severity hardening from pre-public security audit

- **Status:** Open
- **Surfaced:** 2026-05-28 (security audit pre-public)
- **Items:**
  - **Admin dashboard frontend has no auth gate** — `admin/` React app does not verify a JWT/role before rendering. Mitigated today: admin API is dev-only (`requireDevMode` → 403 in prod) and admin is not deployed to prod. Add a JWT/role gate before shipping admin to production.
  - **CSP uses `'unsafe-inline'` (style-src frontend; script-src+style-src admin)** — `frontend/index.html` and `admin/index.html` ship a CSP, but the game's inline `style="..."` attributes and Vite/React require `'unsafe-inline'` (and `'unsafe-eval'` for admin dev). Tighten over time (nonces/hashes, move inline styles to classes). Tracked as follow-up.
  - **No HSTS in helmet config** (`api/src/index.js`) — likely set by nginx in prod; confirm, and add `hsts` to helmet for defense-in-depth if not.
  - **Exception-tracking sanitizer uses substring blacklist** (`api/src/services/exceptionTrackingService.js`) — `token`/`password`/`secret`/`apiKey`/`authorization` substrings are caught (so `refreshToken`/`bearerToken` are covered), but an allowlist would be safer long-term.
- **Why deferred:** None is exploitable for the public-repo / server-compromise threat model being closed in this pass; all are incremental hardening.
- **Effort:** Low each.
- **References:** plan `~/.claude/plans/perform-a-full-and-merry-owl.md` (F9–F12).

### No max-length validation on passwords (bcrypt 72-byte silent truncation)

- **Status:** Open
- **Surfaced:** 2026-05-29 (flagged by security-auditor during the bcrypt 5→6 upgrade; pre-existing, not a regression)
- **Reproducer:** Register with a password longer than 72 UTF-8 bytes. `auth.js:30` enforces only a minimum (`password.length < 8`); there is no maximum. bcrypt silently truncates input at 72 bytes, so bytes beyond 72 are ignored — two distinct long passwords sharing a 72-byte prefix would authenticate interchangeably.
- **Why deferred:** Not a regression (bcrypt 6 did not change truncation behavior) and out of scope for the dependency-remediation pass. Exploit value is low (requires a >72-byte password and a shared prefix).
- **Why it matters:** Defense-in-depth + user clarity — silent truncation is surprising and weakens entropy for very long passphrases.
- **Effort:** Low. Add a max-length check (e.g. reject > 72 bytes, or pre-hash with SHA-256 to bcrypt) alongside the existing min-length gate in `api/src/routes/auth.js:30` and `api/src/services/registrationService.js`.
- **References:** `api/src/routes/auth.js:15,30` (SALT_ROUNDS=12, min-length), `api/src/services/registrationService.js:22`.
