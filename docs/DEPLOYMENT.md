# Modia Production Deployment

Modia is deployed to **mittonvillage.com** using the **`lsd`** CLI — the Lifestream Dynamics deployment tool. There are no project-local deploy scripts; everything is driven by `deploy.yaml` plus the `lsd` binary on your workstation.

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
| **4. nginx** | Render `api-spa.conf.tpl` → `/etc/nginx/sites-available/modia.conf`. `nginx -t` (isolated) → move into place → `nginx -T` (full-tree). |
| **5. Cutover** | **Point of no return.** Atomic `ln -sfn` swap + `mv -T` → `current/`. nginx reload under `nginx.reload` lock. |
| **5b. Service reload** | PM2: `modia-api` (fork mode, singleton, 512M cap) reload. |
| **6. Post-deploy hooks** | `npm run db:migrate` (declared in `deploy.yaml`'s `hooks.post_deploy`). |
| **7. Health** | Probe `https://modia.mittonvillage.com/api/health`. Expect 200, retries 6, 30s timeout. Failure → fail the deploy (rollback responsibility is on the operator). |
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
| SSH access to `root@mittonvillage.com` | `ssh root@mittonvillage.com true` |

> **`ControlMaster` recommendation.** Add to `~/.ssh/config` to avoid re-handshaking on every SSH call lsd makes:
> ```
> Host mittonvillage.com
>     ControlMaster auto
>     ControlPath ~/.ssh/cm-%r@%h:%p
>     ControlPersist 10m
> ```

### Server (provisioned out-of-band)

| Component | Notes |
|-----------|-------|
| Ubuntu 24.04 LTS | |
| Node.js 20+ | |
| PostgreSQL 16 | System service (not Docker). DB `modia_production` carries ≥80 tables (sanity-check threshold). |
| nginx 1.24+ | Templates rendered by lsd at deploy time. |
| PM2 6+ | Process layout declared in `deploy.yaml`'s `services:` block. |
| `lsd-vault-agent` | Installed once via `lsd vault init`; renders secrets into release dirs. |

---

## `deploy.yaml` — the source of truth

Source: `/home/eric/Projects/Modia/deploy.yaml`. Key fields:

```yaml
name: modia
plugin: npm-workspace        # build/stage strategy: workspace-aware
target: vps
remote:
  host: mittonvillage.com
  user: modia                # runtime user for the app
  ssh_user: <SSH_USER>             # used for layout / nginx / pm2 ops
  app_dir: <APP_DIR>
  releases_kept: 5
runtime:
  port: 3110
build:
  commands: [ npm run build -w frontend ]
  include: [ api/src, api/package.json, frontend/dist, frontend/package.json,
             shared, package.json, package-lock.json ]
secrets:
  provider: lsd-vault
  lsd_vault:
    keys: [ DB_HOST, DB_NAME, DB_PORT, DB_USER, DB_PASSWORD,
            JWT_SECRET, JWT_REFRESH_SECRET, WORLD_SEED, NODE_ENV ]
services:
  - name: modia-api
    kind: pm2
    script: api/src/index.js
    exec_mode: fork
    singleton: true
    max_memory: 512M
health:
  url: https://modia.mittonvillage.com/api/health
  expect_status: 200
db_sanity_check:
  min_tables: 80
nginx:
  template: api-spa.conf.tpl
  server_name: modia.mittonvillage.com
  vars: { upstream: "127.0.0.1:3110", static_root: "frontend/dist" }
hooks:
  post_deploy:
    - { id: db-migrate, cmd: npm run db:migrate, cwd: current }
```

When you change this file, run `lsd config validate modia` before committing.

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
   curl -s https://modia.mittonvillage.com/api/health
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
| `LSD_VAULT_HOST unset` warning | `export LSD_VAULT_HOST=mittonvillage.com` in your shell rc. |
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
Local workstation                                VPS (mittonvillage.com)
┌──────────────────────┐                         ┌────────────────────────────────────────┐
│  lsd CLI             │   ssh / rsync           │  <APP_DIR>/                       │
│  ├─ deploy.yaml      │ ──────────────────────► │  ├─ releases/                          │
│  ├─ git tag          │                         │  │   ├─ v0.4.44/                       │
│  ├─ build (npm)      │                         │  │   ├─ v0.5.0/        ← current       │
│  └─ stage            │                         │  │   └─ ...                            │
│                      │                         │  ├─ shared/  (logs, .env shared bits)  │
└──────────────────────┘                         │  └─ current → releases/v0.5.0          │
                                                 │                                        │
                                                 │  lsd-vault-agent  →  .env.production   │
                                                 │  pm2  →  modia-api (port 3110)         │
                                                 │  nginx  →  modia.mittonvillage.com     │
                                                 │            ├─ /          static SPA    │
                                                 │            ├─ /api/      → :3110       │
                                                 │            └─ /health    → :3110       │
                                                 │  PostgreSQL 16  →  modia_production    │
                                                 └────────────────────────────────────────┘
```

---

## Related

- `deploy.yaml` — deploy configuration (source of truth)
- `lsd plan modia` — current pipeline for the latest tag
- `lsd deploy --help` — flags reference
- `~/.local/bin/lsd` — CLI binary (`lsd version` to inspect)
