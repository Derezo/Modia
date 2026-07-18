# Authored Player Animation Generation Progress

Last checkpoint: 2026-07-16 22:30 UTC

This is the resumable operator checkpoint for the 60 base player identities described in [AUTHORED_PLAYER_ANIMATIONS.md](./AUTHORED_PLAYER_ANIMATIONS.md). The per-identity JSON status, pins, and retained source PNGs remain the authoritative evidence. A completed entry means the reference and every non-derived animation atlas are retained in both raw chroma and accepted RGBA form, the spec is approved and pinned, and deterministic runtime compilation succeeded. `dead` is derived from the terminal `death` frame.

Current total: **10 / 60 complete**. The other 50 identities have frozen draft specs and staged identity/style inputs but still require candidate generation.

| Race | Gender | Wizard | Monk | Chemist | Warrior |
|---|---|---:|---:|---:|---:|
| dwarf | female | complete | staged | staged | staged |
| dwarf | male | complete | staged | staged | staged |
| dwarf | other | complete | staged | staged | staged |
| elf | female | complete | staged | staged | staged |
| elf | male | complete | staged | staged | staged |
| elf | other | complete | staged | complete | staged |
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

The next identity in the current elf-first work order is `elf_other_monk`. Generate its `reference`, `idle`, `walk`, `attack`, `hurt`, `death`, and `victory` candidates from the exact frozen prompts, remove chroma, review, approve, pin, and compile.
