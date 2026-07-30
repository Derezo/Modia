# Project Agent Instructions

## Battle Map V3 activation

- Battle Map V3 must become active automatically wherever approved V3 content
  is implemented and deployed. It must not require an environment change or an
  operator toggle.
- Do not add V3 environment variables, feature flags, rollout gates, shadow
  modes, kill switches, enabled-profile lists, or configurable fallback
  switches.
- Do not copy the existing V2 flag/gate pattern into V3.
- The deployed, tracked catalog is the activation mechanism. When an approved
  V3 catalog entry exists for a supported encounter, deterministic catalog
  selection must use it automatically.
- During the migration only, absence of eligible V3 catalog content may invoke
  the explicitly coded V2 compatibility path. Catalog coverage alone determines
  this new-battle fallback, never runtime configuration or client capability.
- Client capability must not negotiate a lower map version for new-battle
  selection. A client unable to render an automatically selected V3 map
  receives an upgrade-required response.
- Pin the current catalog release in tracked, versioned application data.
  Change it through a normal code/content deployment. Roll back by deploying
  the previous verified code/catalog/asset release, not by changing an
  environment variable.
- Persisted V1/V2 battles remain readable according to their stored schema;
  this compatibility is not an activation gate for new V3 battles.
- Add static and behavioral tests that reject new `BATTLE_MAP_V3_*`
  environment reads or feature-flag-provider dependencies and prove automatic
  selection from catalog coverage.
- This prohibition applies to runtime activation and rollout controls.
  Deterministic validation, schema checks, content approval, and release
  acceptance criteria remain mandatory.
