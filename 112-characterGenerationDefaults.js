/**
 * Resolve optional SD1.5 candidate defaults from the current manifest shape.
 * Nested staged-candidate values take precedence per field while the legacy
 * generationDefaults.sd15 block remains supported during metadata migration.
 */
export function resolveSd15CandidateDefaults(manifest = {}) {
  const legacyDefaults = manifest?.generationDefaults?.sd15 || {};
  const stagedCandidateDefaults = manifest?.generationDefaults?.stagedCandidate?.diffusion?.sd15 || {};
  return { ...legacyDefaults, ...stagedCandidateDefaults };
}
