# Findings Outside Scope

Issues identified during work but deliberately deferred. When closed, **delete the entry** — git history is the audit trail.

Operational release gates (human-owned: migration dry-runs, deploy windows, monitoring) live in [`docs/operations/RELEASE_GATES.md`](docs/operations/RELEASE_GATES.md).

---

## Open

### AI still keeps its own copies of skill classification (runtime/AI drift risk)

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 release review, AoE caster-exclusion fix)
- **Reproducer:** `git grep -n "function hasOffensiveSkillComponent\|function hasDamageSkillComponent\|function hasHostileStatusSkillComponent" api/src/services` still lists `ai/stateEvaluator.js`, `ai/actionGenerator.js` and `ai/utilityFactors.js`. `battle/actionProcessor.js` and `ai/cache.js` now share `battle/skillClassification.js`.
- **Why deferred:** The stateEvaluator/actionGenerator variants differ slightly (`isAllyTargetingSkill`, `isRestorativeSkill`), so folding them in changes AI scoring and needs its own AI regression pass; the release fix only needed runtime and simulator to agree.
- **Effort:** Medium (move the variants into `skillClassification.js`, reconcile the ally/restorative rules, re-run `npm run test:unit:ai`).
- **References:** `api/src/services/battle/skillClassification.js`, `api/src/services/ai/stateEvaluator.js:77-148`, `api/src/services/ai/actionGenerator.js:413`, `api/src/services/ai/utilityFactors.js:35`.

### Stale `character_items.is_equipped` column

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 release review; guildmaster gear read by `is_equipped`)
- **Reproducer:** `SELECT count(*) FROM character_items WHERE equipped_slot IS NOT NULL AND is_equipped = false;` is non-zero on dev (18 rows). The equip route (`api/src/routes/inventory.js` equip UPDATE) never writes `is_equipped`; only starter-item inserts do.
- **Why deferred:** No reader uses it any more (the guildmaster query now filters on `equipped_slot`), so it is latent. Dropping it needs a migration plus touching the starter inserts.
- **Effort:** Low (migration to drop the column and `idx_character_items_equipped`, remove the writes in `characters.js:345/370` and `registrationService.js:219/243`).
- **References:** `api/src/services/guildmasterBattleService.js` (`createSoloPlayerUnit`), `api/src/routes/characters.js:345`, `api/src/services/registrationService.js:219`.

### Advancement material progress credits every combatant for one drop

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 release review, "bench characters earn progress" finding)
- **Reproducer:** Win a PvE fight with a 3-character formation where one material drops; `BattleTerminalProgression.applyMutations` calls `updateMaterialProgressWithClient` for each of the 3 combatants with the full quantity.
- **Why deferred:** Bench characters no longer receive credit (IDs now come from the battle's player units). Whether one drop should count for the whole formation is a design call, not a defect fix.
- **Effort:** Low (credit materials to the leader or looter only, if design agrees).
- **References:** `api/src/services/battle/BattleTerminalProgression.js:208-245`, `api/src/routes/battle.js` (PvE victory `partyCharacterIds`).

### Boss summons and death aura are defined but never run

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 release, discovery finding 53)
- **Reproducer:** A boss phase whose `effects.summons` is set transitions without spawning anything, and `applyAuraDamage` is never called. Phase transitions themselves now fire from the player route and the enemy loop (`bossService.checkAllBossTransitions`).
- **Why deferred:** Spawning units mid-battle touches turn order, the battle map occupancy and the client unit roster; it needs its own design and tests rather than a release-hardening patch.
- **Effort:** Medium.
- **References:** `api/src/services/bossService.js` (`checkAllBossTransitions`, `processBossDamage`), `api/src/services/battleTurnManager.js` (enemy loop), `api/src/routes/battle.js` (~1716-1790).

### Battle rejoin after the 30 s disconnect timer is not recorded

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 release review, realtime finding 4)
- **Reproducer:** In a multi-human battle, stay disconnected past the 30 s window, then rejoin. `markRejoined` only commits and broadcasts `player_reconnected` while the in-memory timer still exists, so `state.disconnectedPlayers` keeps the player and others never see the reconnect. Single-human PvE is no longer tracked, so it is unaffected.
- **Why deferred:** Only multi-human battles reach this path; the fix needs a persisted-state reconciliation on join rather than the timer lookup.
- **Effort:** Low.
- **References:** `api/src/services/battleReconnection.js` (`markRejoined`), `api/src/websocket/messageHandlers.js` (`handleJoinBattle`).

### Files over the 3500-line blocking limit

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 release; all were already over the limit on main or grew with the cave-pipeline WIP)
- **Reproducer:** `wc -l frontend/src/scenes/BattleScene.js scripts/battle-art/lifecycle.test.mjs scripts/battle-art/lifecycle.mjs scripts/battle-art/generate.mjs scripts/battle-maps/content-release-lifecycle.mjs` gives 4251, 13137, 8527, 6100 and 3563 (BattleScene was 4084 on main).
- **Why deferred:** Splitting BattleScene or the battle-art lifecycle mid-release is a large refactor with high regression risk; each needs its own pass per ESTABLISHED_PATTERNS.md section 10.
- **Effort:** Medium to large each.
- **References:** `docs/ESTABLISHED_PATTERNS.md` section 10, the files above.

### Remaining UI polish from the 0.5.2 screenshot review

- **Status:** Open
- **Surfaced:** 2026-09-29 (live screenshot passes, rounds 1-2)
- **Items:**
  - The mobile world-map HUD chip renders at about 52x24 CSS px with tiny text (`frontend/src/worldmap/WorldMapHUDPanel.js`).
  - Marketplace estimated prices are erratic for low-base templates with rolled rarity and augments (`api/src/services/marketplace/itemListings.js` suggested price).
  - The first click after returning to the world map was intermittently ignored; not reproduced after the rAF change in `frontend/src/worldmap/NodeActionMenu.js`.
  - The battle soft-lock on a later player turn was not reproduced live; camera callbacks and stranded-turn recovery were fixed from code reading (`frontend/src/battle/BattleCamera.js`, `frontend/src/battle/BattleWebSocketManager.js`). Watch player reports.
  - The damage preview can overlap the target card and extend past the canvas edge (`frontend/src/scenes/BattleScene.js`).
  - The battle minimap road fragments do not match the map, and the formation preview's enemy counts and ENEMY label are hard to read (`frontend/src/battle/BattleMinimap.js`, `frontend/src/scenes/BattleFormationScene.js`).
  - Marketplace Browse rows found by the new server search are not kept in `context.searchResults`, so they vanish if the tab re-renders (e.g. after a purchase) until the player types again (`frontend/src/scenes/marketplace/tabs/MarketplaceSearchTab.js` `bindServerSearch`). Relatedly, `api/src/routes/marketplace/search.js` does not escape `%`/`_` in the ILIKE term (loose matching only; the query is parameterized).
  - Template descriptions can contradict the rolled material (e.g. a bronze description on an Iron Axe) (`api/src/db/templates/items.js`).
- **Why deferred:** Low severity or not reproducible; each needs a focused design or content pass.
- **Effort:** Low each.

### Palace node features have no client handlers

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 release, discovery finding 114)
- **Reproducer:** Open the palace node menu. `throne_room`, `treasury` and `royal_guard` are no longer rendered because nothing handles them, so the palace shows only Fast Travel and Rest.
- **Why deferred:** Giving the palace real features is content design, and changing `PALACE_FEATURES` requires a world regeneration or migration.
- **Effort:** Medium.
- **References:** `api/src/db/worldgen/constants.js` (`PALACE_FEATURES`), `frontend/src/worldmap/NodeActionMenu.js` (`HANDLED_FEATURES`).

### Asset URLs are not versioned, so regenerated art can stay cached

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 art regeneration: coliseum icon, female dwarf portraits, Shocking augment icon)
- **Reproducer:** A browser that cached `/assets/.../dwarf_female_*.webp` before the deploy keeps the bearded portrait until its cache entry expires. Asset paths from `shared/assetPaths.js` have no hash or version query.
- **Why deferred:** Needs a cache-busting scheme across `shared/assetPaths.js` and the nginx cache headers for `/assets/`.
- **Effort:** Low to medium.
- **References:** `shared/assetPaths.js`, `frontend/vite.config.js` (dev sets `Cache-Control: no-cache` only), `deploy.yaml` nginx template.

### Frontend tests collide with a running dev server; `node --watch` misses reloads

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 release verification)
- **Reproducer:** With `npm run dev` running, `npm run test -w frontend` fails 5-8 Vite-booting test files with `Port 24678 is already in use` or `ENOSPC: System limit for number of file watchers reached`; each passes when run alone. Under the same inotify pressure the API's `node --watch` stopped restarting and served stale code for hours.
- **Why deferred:** Environmental; the fix is test isolation (disable HMR and watchers in test Vite instances) and documenting `fs.inotify.max_user_watches`.
- **Effort:** Low.
- **References:** `frontend/src/scenes/__tests__/BattleScene*.test.js`, `frontend/vite.config.js`, `api/package.json` (`dev` script).

### Most gear augment effect types are not applied in combat

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 plan validation, roadmap finding 110)
- **Reproducer:** Equip an item with a `damage_reduction`, `damage_bonus`, `physical_attack`/`defense`, `magic_defense`, `heal_on_hit`, elemental, `damage_vs` or proc augment and fight: none change combat. Only `stat_bonus`, `crit_chance`, `crit_damage` and `lifesteal` are wired (`api/src/services/battle/equipmentAugmentEffects.js`). The UI marks the rest "not yet active" via `ACTIVE_AUGMENT_EFFECT_TYPES`.
- **Why deferred:** Each effect type needs combat design and balance tests; the UI already tells players which augments are inactive.
- **Effort:** Medium to large.
- **References:** `api/src/services/battle/equipmentAugmentEffects.js`, `api/src/services/battle/damageCalculator.js`, `frontend/src/utils/statDisplay.js` (`ACTIVE_AUGMENT_EFFECT_TYPES`), `docs/ITEM_SYSTEM.md` section 5.4.

### Tests that copy logic instead of importing it

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 plan validation, test-quality review)
- **Reproducer:** These pass even if the real code is deleted, because they exercise hand-written copies: `api/src/tests/unit/websocket/sessionReplacement.unit.test.js:65`, `frontend/src/api/__tests__/websocket.test.js:42` (TestableGameWebSocket), the five reconnect tests in `api/src/tests/unit/turnTimer.unit.test.js:957`, and the "Battle Scene Integration Pattern" block in `frontend/src/ui/parchment/__tests__/parchmentConfirm.test.js:229`. Real behaviour is partly covered by `coliseumDisconnectReconnect.integration.test.js`, `tokenRefreshReconnect.test.js` and the e2e battle spec.
- **Why deferred:** Rewriting them needs small extractions (e.g. `shouldSkipDisconnectCleanup` out of `api/src/websocket/index.js`) and is test work, not a release defect.
- **Effort:** Medium.
- **References:** the files above.

### Frontend and API compute equipment stats with different rules

- **Status:** Open
- **Surfaced:** 2026-09-29 (0.5.2 plan validation, dedup review)
- **Reproducer:** `frontend/src/utils/effectiveStats.js` `sumItemStats` merges `magic_attack`/`magicAttack` and falls back per object, while the API (`api/src/services/equipmentStats.js` `resolveItemBaseStats`) falls back per key. An item with partial `baseStats` can show a different number in the Formation or Character modal than battle uses.
- **Why deferred:** The server side was consolidated in 0.5.2 (parity test `equipmentStatsParity.integration.test.js`); making the client consume one shared rule (e.g. from `shared/`) is a cross-cutting refactor.
- **Effort:** Medium.
- **References:** `frontend/src/utils/effectiveStats.js`, `frontend/src/utils/statDisplay.js` (`sumItemStats`), `api/src/services/equipmentStats.js`.

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
