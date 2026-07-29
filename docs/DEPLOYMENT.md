# Modia Production Deployment

Modia is deployed to the production host using the **`lsd`** CLI — the Lifestream Dynamics deployment tool. There are no project-local deploy scripts; everything is driven by `deploy.yaml` plus the `lsd` binary on your workstation.

> **Infrastructure values are placeholders in this public doc.** `<PRODUCTION_HOST>`, `<PRODUCTION_DOMAIN>`, `<SSH_USER>`, `<APP_DIR>`, and `<APP_PORT>` below stand in for the real values, which live in the local (gitignored) `deploy.yaml` and in `lsd-vault`. Substitute mentally when running commands.

The legacy bash-based pipeline (`scripts/deploy/*.sh`, `ecosystem.config.js`, `.github/workflows/deploy.yml`) was removed in `v0.5.0`. If you find a reference to those, treat it as stale and report it.

---

## Quick Reference

```bash
lsd doctor                      # Validate local environment (git, ssh, rsync, vault)
lsd config validate             # Validate deploy.yaml
lsd plan                        # Print every phase + remote command (non-mutating)
lsd secrets ls modia            # List vault keys (names only, never values)
lsd secrets diff modia          # Diff declared keys vs vault contents
lsd status modia                # Currently deployed version + health
lsd history modia               # Append-only deploy ledger
lsd deploy modia                # Deploy latest git tag
lsd deploy modia v0.5.0         # Deploy a specific tag
lsd deploy modia --dry-run      # Plan only — no transport, no cutover
lsd rollback modia              # Roll back to the previous release
lsd rollback modia v0.4.44      # Roll back to a specific release
```

---

## How a Deploy Works

`lsd deploy modia` runs an 8-phase pipeline. Each phase is idempotent and the runner holds a per-app lock so concurrent deploys are impossible.

| Phase | What happens |
|-------|--------------|
| **0. Resolve** | Resolve latest git tag + SHA in worktree. Acquire local `.deploy.lock`. |
| **1. Preflight** | `git status --porcelain` clean check. SSH key perms (0600). Ping the VPS. |
| **1.5. Secrets preflight** | Diff declared keys (`deploy.yaml`) against `lsd-vault`. Seed log scrubber from values. |
| **2. Build + stage** | Run `build.commands` locally. `npm-workspace` plugin stages `api/`, `frontend/dist`, `shared/` into `.deploy-staging/<v>/app/`. |
| **3. Transport** | Acquire remote lock. Ensure `<APP_DIR>/{releases,shared}` layout. Reconcile any half-finished prior deploy. `rsync` to `releases/<v>.partial/`. Write `MANIFEST.json`. Atomic finalize: `mv <v>.partial → <v>` (previous → `<v>.old`). |
| **3.5. Secrets write** | VPS-side: `lsd-vault-agent` decrypts and renders `<release>/.env.production` (mode 0600, owner `modia`). Secrets never touch the network in plaintext. |
| **4. nginx** | Render `api-spa.conf.tpl` → `/etc/nginx/sites-available/<app>.conf`. `nginx -t` (isolated) → move into place → `nginx -T` (full-tree). |
| **5. Cutover** | **Point of no return.** Atomic `ln -sfn` swap + `mv -T` → `current/`. nginx reload under `nginx.reload` lock. |
| **5b. Service reload** | PM2: `modia-api` (fork mode, singleton, 512M cap) reload. A worker that observes not-yet-migrated outbox schema enters a quiet schema-blocked retry state. |
| **6. Post-deploy hooks** | `npm run db:migrate` (declared in `deploy.yaml`'s `hooks.post_deploy`). The worker automatically resumes after the additive schema appears. |
| **7. Health** | Probe `https://<PRODUCTION_DOMAIN>/api/health/ready`. Expect 200, retries 6, 30s timeout. Readiness includes the database and durable terminal-effect worker; failure fails the deploy (rollback responsibility is on the operator). |
| **8. Prune + ledger** | Keep newest 5 finalized releases. Append entry to `lsd` ledger and git-push it. |

Run `lsd plan modia` at any time to print the current pipeline for the latest tag — it's the source of truth.

---

## Prerequisites

### Local workstation

| Requirement | Check |
|-------------|-------|
| `lsd` CLI | `lsd version` |
| Local environment OK | `lsd doctor` |
| Git tag for the version you're deploying | `git tag -l` |
| Clean working tree | `git status` |
| SSH access to `<SSH_USER>@<PRODUCTION_HOST>` | `ssh <SSH_USER>@<PRODUCTION_HOST> true` |

> **`ControlMaster` recommendation.** Add to `~/.ssh/config` to avoid re-handshaking on every SSH call lsd makes:
> ```
> Host <PRODUCTION_HOST>
>     ControlMaster auto
>     ControlPath ~/.ssh/cm-%r@%h:%p
>     ControlPersist 10m
> ```

### Server (provisioned out-of-band)

| Component | Notes |
|-----------|-------|
| Ubuntu 24.04 LTS | |
| Node.js 20+ | |
| PostgreSQL 16 | System service (not Docker). The production DB carries ≥80 tables (sanity-check threshold). |
| nginx 1.24+ | Templates rendered by lsd at deploy time. |
| PM2 6+ | Process layout declared in `deploy.yaml`'s `services:` block. |
| `lsd-vault-agent` | Installed once via `lsd vault init`; renders secrets into release dirs. |

---

## `deploy.yaml` — the source of truth

Source: `deploy.yaml` at the repo root. **This file is gitignored** (it carries infrastructure detail) — keep your copy local and/or in `lsd-vault`. Structure (real host/user/path/port values redacted as placeholders):

```yaml
name: modia
plugin: npm-workspace        # build/stage strategy: workspace-aware
target: vps
remote:
  host: <PRODUCTION_HOST>
  user: <APP_USER>           # runtime user for the app
  ssh_user: <SSH_USER>       # used for layout / nginx / pm2 ops
  app_dir: <APP_DIR>
  releases_kept: 5
runtime:
  port: <APP_PORT>
build:
  commands: [ npm run build -w frontend ]
  include: [ api/src, api/package.json, frontend/dist, frontend/package.json,
             shared, package.json, package-lock.json ]
secrets:
  provider: lsd-vault
  lsd_vault:
    keys: [ DB_HOST, DB_NAME, DB_PORT, DB_USER, DB_PASSWORD,
            JWT_SECRET, JWT_REFRESH_SECRET, WORLD_SEED, NODE_ENV,
            BATTLE_MAP_DIAGNOSTICS_TOKEN,
            BATTLE_MAP_V2_ENABLED_MODES,
            BATTLE_MAP_V2_SHADOW_SAMPLE_RATE,
            BATTLE_MAP_V2_SHADOW_MAX_CONCURRENT,
            BATTLE_MAP_V2_GENERATION_P95_SLO_MS,
            BATTLE_MAP_REFERENCE_DELTA_ENABLED ]
services:
  - name: modia-api
    kind: pm2
    script: api/src/index.js
    exec_mode: fork
    singleton: true
    max_memory: 512M
health:
  url: https://<PRODUCTION_DOMAIN>/api/health/ready
  expect_status: 200
db_sanity_check:
  min_tables: 80
nginx:
  template: api-spa.conf.tpl
  server_name: <PRODUCTION_DOMAIN>
  vars:
    upstream: "127.0.0.1:<APP_PORT>"
    static_root: "frontend/dist"
    proxy_ws_path: "/ws"
    security_headers: "true"
    # Keep resource origins aligned with frontend/index.html. Production can
    # restrict WebSockets to the public TLS endpoint instead of ws:/wss:.
    csp: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss://<PRODUCTION_DOMAIN>; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
hooks:
  post_deploy:
    - { id: db-migrate, cmd: npm run db:migrate, cwd: current }
```

When you change this file, run `lsd config validate modia` before deploying.
`security_headers: "true"` enables the `api-spa.conf.tpl` browser-security
baseline; without it, nginx does not emit HSTS, clickjacking protection, or the
other template-managed headers. The `csp` value is independent and must also be
set explicitly. LSD checks the configured headers after a deploy and records a
warning if the public response is missing any of them.

---

## Battle-map V2 staged rollout

Battle-map V2 has independent generation and transport kill switches. Both
default off. Do not use `*` for the initial rollout, and do not enable
reference/delta delivery in the same change that first enables V2 generation.

### Controls

| Variable | Safe initial value | Purpose |
|----------|--------------------|---------|
| `BATTLE_MAP_V2_ENABLED_MODES` | unset or empty | Comma-separated generation modes. Authoritative creation paths currently use `pve`, `guild`, and `pvp_coliseum`; `pve_coop` and `pvp` are generator-reserved values until matching creation paths exist. |
| `BATTLE_MAP_V2_SHADOW_SAMPLE_RATE` | `0` | Deterministic fraction from `0` through `1` of eligible V1 generations shadowed by V2. |
| `BATTLE_MAP_V2_SHADOW_MAX_CONCURRENT` | `1` | Bounds shadow CPU and memory work; values above 8 are clamped. |
| `BATTLE_MAP_V2_GENERATION_P95_SLO_MS` | unset during baseline | Absolute deployment p95 SLO evaluated from live `generation.active.v2.durationMs` samples. Until set, telemetry enforces the initial shadow-V2/paired-V1 p95 ratio of at most 2 after 20 paired samples. |
| `BATTLE_MAP_REFERENCE_DELTA_ENABLED` | `false` | Enables negotiated immutable-map references and revisioned mutable updates. Full snapshots remain the safe fallback. |
| `BATTLE_MAP_DIAGNOSTICS_TOKEN` | unique 32+ byte secret | Protects seed/hash-level operator diagnostics. A player JWT is not accepted. |

The tested default wire limits may be overridden only from measured deployment
data:

| Variable | Default bytes |
|----------|---------------|
| `BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES` | `4000000` |
| `BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES` | `1250000` |
| `BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES` | `1000000` |
| `BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES` | `256000` |

Omitting an override retains the default. Invalid values fail closed to the
default rather than removing the limit.

### Pre-enable checklist

1. Run the complete test/build suite, the 1,600-map audit, and the browser
   gallery. Review both fixed-seed and unseen-seed screenshots; a passing
   numeric corpus is not a substitute for visual approval.
2. Deploy with live modes empty, shadow sampling `0`, and reference/delta
   delivery false.
3. Confirm migrations `052` through `056` are applied with
   `npm run db:status`. `/api/health/ready` must report the database and
   terminal-effect worker up. A missing outbox schema intentionally makes
   readiness fail.
4. Configure `BATTLE_MAP_DIAGNOSTICS_TOKEN` through `lsd-vault`. Never reuse
   either JWT secret or a player access token.
5. Start shadowing at a small rate, normally `0.01` to `0.05`, with concurrency
   `1`. Observe at least 20 paired samples across representative sizes and
   recipes before increasing the sample.
6. Monitor `/api/health/metrics`, especially `battleMaps.alerts.active`,
   generation distributions, payload distributions, capability rejection,
   retry, cache-miss, ACK exhaustion, and recovery counters. The initial
   relative-p95 guardrail must pass.
7. Set `BATTLE_MAP_V2_GENERATION_P95_SLO_MS` from the measured production
   baseline and capacity budget. Setting it replaces the initial relative
   guardrail. Confirm `battleMaps.generationP95Slo` reports
   `source=generation.active.v2.durationMs`, `ready=true`, and `breached=false`;
   the threshold must not be chosen merely to silence an alert.

Detailed diagnostics are bounded to the 32 most recent generation and shadow
records and are deliberately absent from public health metrics. Successful
records retain the bounded seed, mode, node type, dimensions, recipe
identity/version, selected attempt, and authoritative/visual/full hashes needed
for deterministic replay. Failure records retain the request/recipe context
without inventing an attempt or hash. Operators can retrieve them with:

```bash
curl -H "Authorization: Bearer <BATTLE_MAP_DIAGNOSTICS_TOKEN>" \
  https://<PRODUCTION_DOMAIN>/api/operations/battle-maps/diagnostics
```

The response is marked `Cache-Control: no-store`. An unset or undersized
operator token makes the route unavailable.

### Activation and rollback

Enable one authoritative mode at a time, beginning with `pve`. Keep each stage
long enough to cover creation, current-state fetch, reconnect, completion,
reward delivery, and client cache-miss recovery before adding the next mode. A
typical sequence is `pve`, then `pve,guild`, then
`pve,guild,pvp_coliseum` after the corresponding mode-specific smoke tests
pass. Do not add the reserved `pve_coop` or `pvp` values until an authoritative
creation path and its end-to-end coverage are implemented.

Enable `BATTLE_MAP_REFERENCE_DELTA_ENABLED=true` only after generation is
stable and compatible clients are deployed. Confirm the target client
population advertises the revisioned mutable-state protocol, verify that
unsupported clients retain the bounded full-snapshot fallback, and compare
initial/rejoin snapshot plus mutable-update byte distributions before and after
that change.

The immediate generation rollback is a configuration rollback in the current
V2-capable release:

1. unset or empty `BATTLE_MAP_V2_ENABLED_MODES`;
2. set `BATTLE_MAP_V2_SHADOW_SAMPLE_RATE=0`;
3. set `BATTLE_MAP_REFERENCE_DELTA_ENABLED=false`; and
4. redeploy/reload the service and verify metrics plus a new V1 battle.

This affects only newly created battles. Persisted V2 battles keep their stored
schema and must remain loadable, so do not roll the binary back to a
pre-V2 release after any live V2 battle has been created. Retain V1 and V2
readers until the persisted-battle retention window has elapsed.

---

## Standard Deploy Workflow

1. **Land your changes on `main`.** Tests must pass; commit cleanly.
2. **Tag the release.**
   ```bash
   # Update root package.json "version" to match, then:
   git tag v<X.Y.Z>
   git push origin main --tags
   ```
3. **Plan the deploy** (optional but recommended for non-trivial changes):
   ```bash
   lsd plan modia
   ```
4. **Deploy.**
   ```bash
   lsd deploy modia                # latest tag
   lsd deploy modia v0.5.0         # explicit version
   ```
5. **Verify.**
   ```bash
   lsd status modia
   curl -s https://<PRODUCTION_DOMAIN>/api/health
   ```
6. **Watch the ledger.**
   ```bash
   lsd history modia | head -5
   ```

---

## Secrets Management (`lsd-vault`)

Secrets live encrypted on the VPS in `lsd-vault` and are rendered into each release's `.env.production` at deploy time. They are **never** stored in this repo.

| Task | Command |
|------|---------|
| List declared keys | `lsd secrets ls modia` |
| Diff declared vs vault | `lsd secrets diff modia` (exit 1 on drift — wire into CI when ready) |
| Set one key (interactive) | `lsd secrets set modia DB_PASSWORD` (prompts for value) |
| Set one key (stdin) | `printf '%s' "$VALUE" \| lsd secrets set modia DB_PASSWORD VALUE=-` |
| Read one key | `lsd secrets get modia DB_PASSWORD` |
| Bulk import from `.env` | `lsd secrets import modia ./.env.production` |
| Edit all keys interactively | `lsd secrets edit modia` |
| Delete a key | `lsd secrets delete modia OLD_KEY` |

Vault administration:

| Task | Command |
|------|---------|
| Bootstrap on a fresh VPS | `lsd vault init` (one-time) |
| Rotate the master key | `lsd vault rotate-master` |
| Upgrade the agent binary | `lsd vault upgrade-agent` |
| Disaster-recovery import | `lsd vault import-from-env modia ./backup.env` |

---

## Rollback

**`lsd` keeps the last 5 releases.** Rollback is an atomic symlink flip — no rebuild, no re-staging.

```bash
lsd rollback modia                  # previous release
lsd rollback modia v0.4.44          # specific release
```

After rollback, run the same verification checklist (`lsd status`, health probe, smoke test).

If a deploy fails between Phase 5 (cutover) and Phase 7 (health check), rollback is the recovery path. Failures in Phases 0–4 are non-destructive: the running release is untouched.

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `lsd doctor` warns about `ControlMaster` | Add the SSH config block above. Cosmetic — deploys still work. |
| `LSD_VAULT_HOST unset` warning | `export LSD_VAULT_HOST=<PRODUCTION_HOST>` in your shell rc. |
| Phase 1 fails on dirty git | Commit/stash changes, or pass `--allow-dirty` (only for emergency hotfixes). |
| Phase 1.5 fails — secret drift | `lsd secrets diff modia` → reconcile with `lsd secrets set` / `delete`. |
| Phase 7 health probe fails | Check `pm2 logs modia-api` on the VPS, then `lsd rollback modia`. Investigate before the next deploy. |
| `db_sanity_check` fails (< 80 tables) | The runtime `.env.production` is pointing at the wrong DB. Check `DB_NAME` / `DB_HOST` in vault. |
| Need to skip a single preflight | `lsd deploy modia --skip-check <name>` (see `lsd deploy --help`). Use sparingly. |
| Need to skip the health check | `lsd deploy modia --no-health` (dangerous — only when the health endpoint itself is broken and you're shipping the fix). |

For a full list of escape hatches: `lsd deploy --help`.

---

## Architecture

```
Local workstation                                VPS (<PRODUCTION_HOST>)
┌──────────────────────┐                         ┌────────────────────────────────────────┐
│  lsd CLI             │   ssh / rsync           │  <APP_DIR>/                            │
│  ├─ deploy.yaml      │ ──────────────────────► │  ├─ releases/                          │
│  ├─ git tag          │                         │  │   ├─ v0.4.44/                       │
│  ├─ build (npm)      │                         │  │   ├─ v0.5.0/        ← current       │
│  └─ stage            │                         │  │   └─ ...                            │
│                      │                         │  ├─ shared/  (logs, .env shared bits)  │
└──────────────────────┘                         │  └─ current → releases/v0.5.0          │
                                                 │                                        │
                                                 │  lsd-vault-agent  →  .env.production   │
                                                 │  pm2  →  modia-api (port <APP_PORT>)   │
                                                 │  nginx  →  <PRODUCTION_DOMAIN>         │
                                                 │            ├─ /          static SPA    │
                                                 │            ├─ /api/      → :<APP_PORT>  │
                                                 │            └─ /health    → :<APP_PORT>  │
                                                 │  PostgreSQL 16  →  <production DB>     │
                                                 └────────────────────────────────────────┘
```

---

## Related

- `deploy.yaml` — deploy configuration (source of truth)
- `lsd plan modia` — current pipeline for the latest tag
- `lsd deploy --help` — flags reference
- `~/.local/bin/lsd` — CLI binary (`lsd version` to inspect)
