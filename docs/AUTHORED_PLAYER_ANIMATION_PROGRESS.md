# Authored Player Animation Generation Progress

Last checkpoint: 2026-07-17T23:36:49.000Z

This is the resumable operator checkpoint for the 60 base player identities described in [AUTHORED_PLAYER_ANIMATIONS.md](./AUTHORED_PLAYER_ANIMATIONS.md). The per-identity JSON status, pins, retained source PNGs, and compiled runtime outputs remain the authoritative evidence. A completed entry means the reference and every non-derived animation atlas are retained in both raw chroma and accepted RGBA form, the spec is approved and pinned, and deterministic runtime compilation succeeded. `dead` is derived from the terminal `death` frame.

Current total: **23 / 60 complete**. The other 37 identities have draft specs and staged identity/style inputs unless marked otherwise.

| Race | Gender | Wizard | Monk | Chemist | Warrior |
|---|---|---:|---:|---:|---:|
| dwarf | female | complete | complete | complete | complete |
| dwarf | male | complete | complete | complete | staged |
| dwarf | other | complete | staged | staged | staged |
| elf | female | complete | complete | complete | complete |
| elf | male | complete | complete | complete | complete |
| elf | other | complete | complete | complete | complete |
| human | female | complete | staged | staged | staged |
| human | male | complete | staged | staged | staged |
| human | other | complete | staged | staged | staged |
| orc | female | staged | staged | staged | staged |
| orc | male | staged | staged | staged | staged |
| orc | other | staged | staged | staged | staged |
| vampire | female | staged | staged | staged | staged |
| vampire | male | staged | staged | staged | staged |
| vampire | other | staged | staged | staged | staged |

## Resume point

The elf-first work order is complete. Resume with `dwarf_male_warrior`, generating its `reference`, `idle`, `walk`, `attack`, `hurt`, `death`, `victory` candidates as needed from the exact frozen prompts, then remove chroma, review, approve, pin, and compile.
