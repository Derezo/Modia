# Player-Preserving World Regeneration

Use this workflow to replace a populated world's generated graph while keeping
players and progression. Do not use `npm run db:seed`, `npm run db:reset`, or
`npm run db:fresh` for this purpose: those are bootstrap operations and their
cascades can remove player-linked data.

The migration retains characters, character ownership, inventory, equipment,
skills, traits, quests, currencies, discoveries, clearances, parties, battles,
markets, recruits, activity history, and other non-world state. References to
legacy nodes are remapped to the generated graph in one transaction. The old
graph and every world-linked source row are copied into an immutable audit
ledger before the source graph is removed.

## Mapping contract

- Stable keys and regional role anchors are preferred, followed by exact type,
  name, and region matches.
- When the regenerated graph has fewer nodes of a type, mappings may be
  many-to-one and the collision is recorded.
- Discovery collisions merge with `travel` taking precedence over `adjacent`,
  then `initial`.
- Partial combat clearance maps only to compatible combat nodes. An account
  that cleared every combat node in the source world retains full combat
  coverage in the target world.
- Reward claims and other unique activity rows are never silently merged. A
  collision fails the transaction for operator review.
- Character locations and battles are critical references. Every historical
  battle retains its exact node type; active battles additionally require an
  exact compatible combat type.
- A character whose legacy location has no compatible target is moved to that
  character's home-race castle. Every such fallback is recorded per character
  in the confirmed plan, preservation report, and archived character row.
  Missing home-castle targets fail the transaction.
- Shrine, zodiac, lore-discovery, and ruins records retain their gameplay
  identity as well as a valid node reference. Zodiac sign, shrine buff, lore
  key, ruins puzzle type, and ruins reward tier must remain compatible.
- If the base target has no ruins with the required completed-progression
  semantics, planning reserves a distinct generated ruins node for each
  referenced legacy ruins node and applies a deterministic, migration-only
  semantic overlay. The overlay, its hash, and every carrier assignment are
  included in the confirmed plan and persisted world metadata.
- Known node-ID arrays in quest `node_progress` are remapped; unrelated numeric
  counters are left unchanged.
- Any previously unknown foreign key to `world_nodes` fails the plan until its
  preservation policy is implemented.
- Persisted region races are immutable. Established region generator identities
  are also immutable. A legacy region whose generator identity fields are all
  unset may be initialized by the target world; an established or partially
  established identity must match the target exactly.

The regenerated world intentionally has fresh NPC shop stock. Existing player
inventory, purchases, transactions, currencies, and claimed rewards are
preserved, but future unclaimed chest contents can change because chest rolls
include the generated node ID in their deterministic seed.

## 1. Install the migration schema

Apply migrations normally:

```bash
npm run db:migrate
```

Migrations `050_world_migration_audit.sql` and
`051_world_migration_overlay.sql` are additive. They create the durable
migration run, node-map, progress archive tables, and nullable semantic-overlay
metadata; they do not regenerate the world.

## 2. Enter maintenance and make a verified backup

Stop every API and worker process, not only processes expected to write during
the command. Node presence, fishing sessions, and socket rooms retain numeric
node IDs in process memory; allowing an old process to survive the remap can
reintroduce stale IDs after commit. Follow
[WORLD_RESET_BACKUP_RESTORE.md](WORLD_RESET_BACKUP_RESTORE.md) to create and
restore-drill a full PostgreSQL archive. Keep the archive until the migrated
world has passed application smoke tests.

## 3. Produce and review a read-only plan

```bash
npm run world:migrate -- --seed=123456
```

The command reads the current graph and progression, assembles the target twice,
verifies deterministic hashes, inventories every live foreign key, and prints a
SHA-256 `planHash`. It does not start a mutation transaction. Add `--full-plan`
to print every node mapping and collision:

```bash
npm run world:migrate -- --seed=123456 --full-plan
```

Review at least:

- source and target graph hashes and node counts;
- unmapped nodes (must be zero for referenced nodes);
- confidence and many-to-one collision counts;
- exact-type compatibility for all historical battles and active-battle
  compatibility;
- shrine, zodiac, lore, ruins, and region-identity compatibility;
- semantic-overlay carrier assignments and the overlay hash;
- any per-character home-castle fallback relocations;
- reward/activity collision checks;
- protected player-state fingerprints and row counts.

If data changes after planning, the execution-time hash will differ and the
transaction will roll back.

## 4. Execute the exact reviewed plan

Keep all writers stopped. Set the acknowledgements only for the command
invocation:

```bash
ALLOW_PLAYER_PRESERVING_WORLD_MIGRATION=true \
WORLD_RESET_MAINTENANCE_WINDOW=true \
WORLD_RESET_BACKUP_VERIFIED=true \
npm run world:migrate -- \
  --seed=123456 \
  --execute \
  --confirm=<reviewed-plan-hash> \
  --initiated-by=<operator-or-change-ticket>
```

Execution takes a database advisory lock and exclusive table locks, recomputes
the plan from the locked state, and compares the exact hash. It then archives,
inserts, remaps, verifies, and deletes the legacy graph inside one transaction.
Any error rolls the entire operation back.

## 5. Verify before ending maintenance

Keep the game offline while checking:

```bash
npm run db:status
npm run world:migrate -- --seed=123456
```

Also verify:

- the committed row in `world_migration_runs` has the expected plan hash;
- all characters can load and are on valid nodes;
- Derezo's inventory, equipment, skills, discoveries, and clearances match the
  preservation report;
- active battles reconnect or complete normally;
- the world map has connected routes with no orphan path segments;
- shops, guilds, recruits, ruins, travel, and combat work on representative
  nodes.

Retain `world_migration_node_maps`,
`world_migration_progress_archive`, the command output, and the database backup
as the permanent migration evidence. Restart all API and worker processes before
admitting traffic so their caches, sessions, and socket rooms are rebuilt from
the new node IDs. End maintenance only after the restart and checks pass.

## Failure and recovery

An error before commit leaves the source world untouched. Keep maintenance
active, correct the reported policy or mapping issue, generate a new read-only
plan, and review its new hash.

If a defect is discovered after commit, stop writers immediately and use the
verified full backup restore procedure. The audit ledger explains every
old-to-new mapping but is not a substitute for the full database backup.
