# Original full-game Battle Map V3 goal

Provenance: tracked snapshot created 2026-07-31 from the original Codex attachment.

- Source path: `/home/eric/.codex/attachments/634a87fd-091c-43d2-9fc8-0566bde31b4c/pasted-text-1.txt`
- Source SHA-256: `c0b0528ccfda6642a65c7c2e00f39c772e624f25064c585a23b21f890c254b3f`
- Fidelity: everything after the marker below is copied verbatim from the source.

<!-- BEGIN VERBATIM ORIGINAL GOAL -->
Complete Battle Map V3 content across the full game.

  Starting from the repository’s current tracked state, generate, review, approve, compile, integrate, and activate every remaining Battle Map V3 map and battle-art family required by the authoritative biome/theme, regional ecology, tier, encounter-mode, capacity, boss, and competitive-coverage
  matrices.

  Treat this as a persistent, multi-session goal. Resume existing approved work instead of recreating it, maintain a clear readiness ledger, and continue until the full acceptance matrix passes or a genuine external blocker requires user input. Do not stop after planning, scaffolding, or producing
  drafts.

  Core requirements

  1. Respect AGENTS.md and preserve unrelated working-tree changes.
  2. Use explorer, bounded worker, test-runner, and independent reviewer subagents throughout the work. The primary agent owns integration and final acceptance.
  3. Derive scope from the repository’s authoritative matrices and lifecycle tooling. The current expected baseline is 16 themes and the complete 144-map corpus, but treat tracked definitions as authoritative if the matrix has evolved.
  4. Cover all tiers 1–5, regional ecologies, supported modes, roster capacities, boss requirements, and competitive-parity requirements.
  5. Existing approved Borderwood r6/v12 content is the visual and lifecycle reference. Do not mutate or overwrite immutable approved maps, assets, approvals, or releases. Create successor versions and cumulative immutable releases.
  6. Every supported new-battle encounter must automatically select eligible V3 content from the tracked catalog. Do not add environment variables, feature flags, rollout gates, enabled-profile lists, client downgrade negotiation, shadow modes, or kill switches.
  7. Persisted V1/V2/V3 battles must remain readable. V2 fallback is permitted only while approved catalog coverage is genuinely absent. At final completion, no supported current encounter should fall back because of missing content.
  8. Selection must remain deterministic for the same release, node/encounter seed, ecology, mode, tier, and roster. Restarts and refreshes must not reroll a node’s map.

  Art-generation rules

  1. Initiate all raster image generation exclusively through the existing npm lifecycle, especially `npm run battle-art:generate`. Never call image generation directly from the main agent, use ad hoc scripts, or manually drop generated files into runtime locations.
  2. Each candidate worker must make exactly one structured `image_gen.imagegen` call. Blueprint workers must make zero image-generation calls. Preserve the existing environment isolation, output limits, audit records, normalization, approval, and publishing safeguards.
  3. Work in reviewed waves:
     - establish or update the ecology/tier art direction;
     - scaffold exact required families;
     - generate a small representative set;
     - normalize and preview it;
     - visually inspect it;
     - correct prompts or tooling when necessary;
     - only then generate the remainder of that wave.
  4. Reject and regenerate assets with seams, incorrect perspective, inconsistent scale, baked backgrounds, black gaps, wrong directional lighting, poor chroma cleanup, duplicated-looking species, or incompatible tile edges.
  5. Maintain exact runtime dimensions, pivots, masks, transparency, hashes, provenance, prompt records, and descriptor contracts.

  Regional visual direction

  6. Forest ecologies must use visibly distinct regional species, ground cover, soils, deadfall, stones, and atmosphere—for example Heartlands, Sylvan, Shadowmere, and Borderwood must not be palette swaps of one forest.
  7. Caves and mountains must vary geology, strata, crystals, vegetation, rubble, and exposed faces by region.
  8. Palaces, castles, ruins, guilds, camps, bridges, arenas, dungeons, plains, swamps, and volcanoes must each have ecology-appropriate construction or natural materials.
  9. Natural maps should generally use professional organic silhouettes and ecology-matched exterior scenery. Constructed maps may use intentional rectangular or architectural platforms.
  10. Scene-only decoration may enrich nonplayable areas but must never alter collision, traversal, spawn capacity, line-of-sight authority, or gameplay state.

  Map requirements

  11. Produce the required approved source templates, three-layout blueprint families, compiled maps, render profiles, tile catalogs, screenshots, approvals, and catalog entries for every matrix row.
  12. Support all 16 route topologies and direction-aware north/east/south/west stairs, slopes, boundaries, exposed faces, and elevation transitions.
  13. Paths must have coherent soft edges, directional continuity, meaningful tile diversity, and complete underpainting. No sky, black void, raw dark separator, or mismatched elevation face may appear beneath movement routes.
  14. Open spaces must look organic without obscuring tactical readability.
  15. Obstacles must provide regional variety and appropriate density while preserving authored spawn and traversal requirements.
  16. Minimap framing must follow organic silhouettes for natural maps and intentional rectangular silhouettes for constructed maps.
  17. Every positive-weight eligible map must support the maximum roster in its declared coverage band. Capacity failure must fail closed; it must never trigger V2 fallback or roster-driven reselection.

  Review and approval

  18. Render every candidate map through the exact runtime asset bundle at representative gameplay scale.
  19. Review full-map composition and detailed crops containing:
     - every directional slope/stair type;
     - elevation edges;
     - route junctions;
     - exterior boundaries;
     - representative obstacles;
     - player and enemy movement overlays;
     - the minimap.
  20. Use visual inspection rather than metadata alone. Record concrete acceptance or rejection reasons.
  21. Approve only maps and assets that satisfy visual, topology, capacity, provenance, and deterministic-recompile checks.
  22. Use a stable safe reviewer identity such as `codex-full-game-battle-content-review`.
  23. Have an independent reviewer subagent audit every release wave and the final integrated release. Resolve all material findings before activation.

  Release strategy

  24. Publish cumulative immutable releases so newly added coverage never removes previously approved coverage.
  25. Verify exact assets, approvals, map hashes, selector behavior, and all coverage cases before changing the tracked active-release pin.
  26. Activate only verified tracked catalog releases. Do not deploy to an external production environment unless separately authorized.
  27. Preserve historical releases for persisted-battle compatibility and rollback.
  28. On final completion, run the repository’s complete-matrix/corpus acceptance rather than pilot or metadata-only acceptance.

  Validation

  At minimum, run and pass:

  - `npm run battle-art:check`
  - `npm run battle-maps:check`
  - complete catalog/corpus acceptance with binary evidence
  - selector determinism and capacity tests
  - API generation, ecology, guild, arena/Coliseum, boss, and persisted-map tests
  - frontend renderer, minimap, asset-integrity, movement, and session tests
  - lint
  - `git diff --check`

  Add static and behavioral regressions proving that no `BATTLE_MAP_V3_*` activation reads, feature-flag dependencies, client downgrades, or capacity-based V2 fallbacks were introduced.

  Documentation and handoff

  Keep the lifecycle runbook, development commands, asset-system index, release documentation, ecology matrix, readiness records, and current-release references accurate throughout the work. Document how a future session adds a new ecology, tier, art family, template, map version, approval, and cumulative catalog release using npm commands only.

  Definition of done

  The goal is complete only when:

  - the authoritative full-game coverage matrix passes;
  - all required runtime art and maps are generated, visually accepted, approved, compiled, and hash-pinned;
  - all supported new encounters automatically select deterministic V3 content;
  - no eligible map has missing assets or insufficient capacity;
  - all required tests and binary checks pass;
  - the final tracked release is active;
  - documentation matches the active release;
  - an independent final review reports no material findings.

  Report progress by completed coverage rows and approved releases, not by files created. If blocked, identify the exact matrix rows, assets, or approval requirement still outstanding and exhaust safe in-scope alternatives before asking for user input.
