# Documentation Archive

This directory contains archived documentation from the Modia MMORPG project. Files are organized into subdirectories based on their type and purpose.

## Directory Structure

```
docs/archive/
├── README.md                    # This file
├── completed/                   # Completed milestone tracking
│   └── COMPLETED_MILESTONES.md  # Main archive of completed work (v1.0-v10.0)
├── design-docs/                 # Dated design documents
│   └── YYYY-MM-DD-*.md          # Implementation plans and designs
├── deprecated/                  # Superseded document versions
│   └── *_v1.md, *.md            # Old specs replaced by newer versions
└── reports/                     # Validation and analysis reports
    └── PLAN_VALIDATION_REPORT.md
```

## Categories

### completed/

Milestone tracking and version history. Contains the main `COMPLETED_MILESTONES.md` file which documents all completed features, resolved issues, and development progress organized by version.

**When to use:** Archive completed work here when moving items from active roadmaps.

### design-docs/

Dated design documents that describe implementation plans. Files follow the naming convention `YYYY-MM-DD-feature-name-design.md`.

**Contents include:**
- `2026-01-07-ct-turn-system-design.md` - CT-based turn order system
- `2026-01-08-dev-environment-improvements-design.md` - Dev setup scripts, CI/CD
- `2026-01-08-terrain-cost-visibility-design.md` - Movement cost display
- `2026-01-09-shared-battle-modules-design.md` - ESM shared modules
- `2026-01-10-worldmap-travel-system-design.md` - Stamina and travel
- `2026-01-10-security-memory-docs-fixes.md` - Rate limiting, memory leaks
- `2026-01-11-marketplace-item-augments-design.md` - Augmented item trading
- `2026-01-11-map-generation-and-ai-pathfinding.md` - Map validation, AI paths
- `2026-01-11-quest-node-boss-implementation.md` - Guild quests, bosses
- `2026-01-11-pending-features-consolidated.md` - Historical feature tracker
- `2026-01-12-icon-quality-redesign.md` - SVG icon overhaul
- `2026-01-12-formation-inventory-integration-design.md` - UI consolidation
- `2026-01-13-regional-world-generation-design.md` - 5-region world system
- `2026-01-15-gameplay-features-v9-design.md` - Settings, audio, elements
- `2026-01-21-elevation-tilemap-rendering-plan.md` - 3D elevation system
- `2026-01-22-ai-image-post-processing-pipeline.md` - Tile generation improvements

**When to use:** Archive design documents here after implementation is complete.

### deprecated/

Contains superseded document versions that have been replaced by newer implementations or consolidated into other documents.

**Examples:**
- `QUEST_SYSTEM_v1.md` - Replaced by modular quest documentation
- `GAME_MECHANICS_IMPROVEMENTS.md` - Consolidated into ROADMAP_GAMEPLAY.md
- `TECHNICAL_IMPROVEMENTS.md` - Consolidated into ROADMAP_TECHNICAL.md
- `IMAGE_GENERATION_PROMPTS.md` - Archived from removed PixelLab integration

**When to use:** When a document is superseded or consolidated, move it here with an archive notice at the top explaining what replaced it.

### reports/

Validation reports, analysis documents, and audit results.

**When to use:** Archive validation reports and analysis documents that were generated during development phases.

## Archive Process

When archiving a document:

1. **Add archive notice** at the top of the file:
   ```markdown
   > **ARCHIVED:** [Date]
   > **Reason:** [Why archived]
   > **Replaced by:** [New document(s)]
   ```

2. **Move to appropriate directory** based on document type

3. **Update references** in other documents that may link to the old location

4. **Update COMPLETED_MILESTONES.md** if archiving completed work

## Related Files

- `/docs/DEVELOPMENT_ROADMAP.md` - Links to technical/gameplay roadmaps
- `/docs/ROADMAP_TECHNICAL.md` - Technical milestones and debt tracking
- `/docs/ROADMAP_GAMEPLAY.md` - Game feature roadmap
- `/CLAUDE.md` - Project instructions referencing archive structure

---

*Last updated: 2026-01-25*
