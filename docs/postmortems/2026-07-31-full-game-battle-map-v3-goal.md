# Full-game Battle Map V3 persistent-goal postmortem

Date: 2026-07-31 (America/Toronto; some immutable evidence is dated
2026-08-01 UTC)
Status: stopped without completion
Scope: the persistent full-game content goal preserved in the [tracked original-goal snapshot](references/2026-07-31-full-game-battle-map-v3-original-goal.md), whose source was the original attachment at `/home/eric/.codex/attachments/634a87fd-091c-43d2-9fc8-0566bde31b4c/pasted-text-1.txt`.

## Outcome

The user-visible outcome was **one initial complete Battle Map V3 map and zero additional complete maps during the long follow-on**.

The initial complete map was the already tracked Borderwood reference: `forest-template-01-b@12`, its approved runtime art bundle, visual approval, and active r6 catalog entry. The follow-on produced many battle-art candidates, many approved Heartlands art families, a semantically approved `forest-template-03` source template, extensive lifecycle hardening, and immutable rejection evidence. Those are inputs and safeguards, not maps. No follow-on map reached the complete chain of approved blueprint, compiled map, runtime screenshot review, map approval, cumulative catalog entry, and tracked activation.

The original definition of done was therefore not met. The authoritative full-game matrix, complete 144-map corpus, and final cumulative release did not pass; no further generation is authorized from this checkpoint.

At the point the goal was paused, orchestration telemetry reported 82,921
elapsed seconds (about 23 hours) and 13,979,677 tokens. These are goal-level
resource figures, not generation-attempt counts.

## Baseline and accounting boundary

Two views need to be kept separate:

- From the user's outcome perspective, the run began with one complete Borderwood map and ended with that same one complete map.
- From the repository perspective, the baseline commit already contained historical compiled/approved forest-map versions and blueprint-pinned templates 01 and 02. Those historical artifacts do not turn the dirty-tree follow-on into newly completed maps.

The active pin remains `battle-map-v3-forest-pilot-2026-07-30-r6`, with one catalog entry for `forest-template-01-b@12`. The dirty-tree `forest-template-03` sidecar is semantically approved and pins its source and compiler, but `pins.approvedBlueprintSha256` is `null`. It has no complete approved blueprint family, compiled/approved map, or activated catalog entry. The net new complete-map count for the follow-on is zero.

The current checkpoint is a dirty working tree layered on commit `fba8561aa6a8128e8ddb7cfdcd9ecd089f0c9e88` (`feat: add battle map v3 and fishing overhaul`). Much of the follow-on evidence is untracked or modified rather than committed history. This postmortem records what is present at the checkpoint; it does not claim that every intermediate state can be reconstructed from Git alone.

## Timeline

1. **Tracked starting point.** The repository already had the first complete regional reference: Borderwood art bundle v6 with 51 runtime families and the approved `forest-template-01-b@12` map selected by the r6 catalog for the exact Borderwood ecology.
2. **Persistent goal accepted.** The goal expanded delivery to all authoritative themes, ecologies, tiers, modes, capacities, boss/competitive cases, and the complete corpus. It explicitly required progress to be reported in completed coverage rows and approved releases, not file counts.
3. **Heartlands groundwork.** A five-tier Heartlands readiness definition and 43 concrete family requirements were added. Candidate generation and review proceeded across surfaces, routes, directional connections, boundaries, obstacles, and decorations.
4. **A successful but non-repeatable route artifact.** The approved Heartlands straight-EW worker made one Imagegen call, then performed substantial ad-hoc Python image analysis, warping, alpha cleanup, component selection, and repeated numerical validation inside the worker before publishing `candidate.png`.
5. **The production path changed while content work continued.** The stable npm entry points remained stable—most importantly `npm run battle-art:generate` still routed through `scripts/battle-art/cli.mjs generate`—but their implementation and worker contract changed. Deterministic parent-side route finishing was introduced, then direct whole-image generation became the active straight-NS path while the finisher remained as historical/opt-in tooling.
6. **Contract churn concentrated on straight-NS.** Prompt and validator semantics moved among named points as neighborhoods, internal capability-diamond contacts, terminal seam cross-sections, cap centers, and a strict maximum outward continuation. The generated candidates were repeatedly evaluated against these changing interpretations rather than against one frozen, baseline-validated production contract.
7. **v11 and v12 stopped the canary.** The v11 straight-NS candidate was rejected because its terminal seam spans pinched to 10 and 8 pixels. The v12 candidate reached much wider seam contacts but was rejected because its visible silhouette extended 40.7 and 34.9 pixels past the declared terminals, beyond the new 8-pixel limit. Both reviews preserve hashes and provenance. No retry was authorized.
8. **Stopped without another map.** Heartlands assets and `forest-template-03` advanced, but the work never crossed the map delivery boundary. No new blueprint approval, compiled/visually approved map, catalog release, or active-release update was produced.

## What changed from the successful workflow

The npm alias was stable; the production behavior behind it was not.

The approved straight-EW result came from a worker contract that allowed exactly one Imagegen call followed by ad-hoc postprocessing in that same worker. Its currently present, hash-pinned local worker log shows multiple custom Python passes: identifying the generated route axis, warping it into the target raster, removing chroma, selecting a connected component, clearing fringe pixels, and iterating on measurements until the candidate passed. The candidate directory is ignored and its log bytes are not part of this checkpoint commit; the tracked review preserves only their path, byte count, and hash. The final EW asset was approved, but the process was not a clean, frozen, general production method.

Later work correctly tried to move those transformations and checks into audited repository code:

- `finish-route-artifact.mjs` made the finishing derivation explicit and reproducible for opt-in route descriptors.
- The later direct contract required the worker only to generate once, copy the exact current-thread artifact, and stop; the parent performed exact-aspect resize and normalization.
- A straight-route validator introduced a maximum outward extent of 8 pixels from the declared terminals.

Those are individually reasonable hardening moves, but they were not established and validated as one frozen contract before the next content wave. Direct and finisher contracts coexisted. Target terminology was contradictory. The current approved EW baseline says to carry the path into a 20-pixel neighborhood of each named target, whereas the newer NS contract treats named points as exact full-width seam cross-sections followed by caps 4–6 pixels farther out. The new generic `<=8` extent rule cannot be assumed to describe what the approved EW baseline actually proved. In that sense the validator was dead as an acceptance authority: it existed in code, v12 publication did not invoke it before publishing the candidate, and its semantics had not been reconciled with the approved baseline.

The release path also expected an exact current runtime bundle and matching frontend mirror. Heartlands descriptors were approved but not compiled into a complete archived bundle and pinned through a new map/catalog release. Any later map integration would therefore have encountered an expected stale-runtime-bundle boundary until the art release, mirror, map recipe, and catalog were advanced together.

## Symptoms and evidence

### Delivery symptoms

- The active catalog still contains one entry, the initial Borderwood map.
- No tracked `battle-maps/` content delta represents a new complete release.
- `forest-template-03` is source-approved but has `approvedBlueprintSha256: null`.
- Heartlands has 43 planned descriptors at the checkpoint: 39 approved art families and four drafts. None is compiled into a new Heartlands runtime release. This is substantial asset progress, but it is not map progress.
- The complete matrix and 144-map acceptance were never reached.

### Generation and review evidence

At the checkpoint, immutable battle-art review records total 92: 40 approved and 52 rejected. The straight-NS family alone has six rejected reviews and no approved review. Its immutable generated-artifacts directory contains seven raw PNGs and five failed-attempt JSON records.

The user-reported **“3,956 failures” could not be reconciled to tracked generation evidence and was not the Imagegen or map-attempt count**. Repository evidence records one Imagegen invocation per accepted candidate worker record, plus immutable review and failed-attempt artifacts; none supports 3,956 generation attempts. The inability to explain that counter is itself an observability and accounting failure. This postmortem does not invent a meaning for it.

The final straight-NS canaries are unambiguous:

- v11's immutable rejection records coherent Heartlands material and clean transparency, but terminal spans narrowed to 10 and 8 pixels, which would produce pinched or broken joins.
- v12's immutable rejection records near-opaque seam spans of 36 and 33 pixels, but visible overflow of 40.7 and 34.9 pixels against the declared 8-pixel maximum. It also records that publication failed to invoke the existing longitudinal-extent validator.

The current `candidate.png` and candidate metadata still match the rejected v12 hash while the metadata says `candidate-awaiting-review`; the descriptor itself is back at draft content version 12. The immutable review is the decision authority: v12 is rejected. The stale candidate status is another accounting symptom, not permission to reuse or approve those bytes.

## Root cause

The primary root cause was **loss of the complete map as the unit of delivery**.

The goal called for reviewed waves that ended in approved releases and required progress reporting by completed coverage rows. Execution instead optimized locally for art-family throughput and lifecycle correctness. Once the work entered the route-asset bottleneck, it kept refining generation, postprocessing, provenance, validation, locks, worker boundaries, and tests without enforcing a stop condition tied to a newly cataloged map.

This was not caused by one bad generated image or one reviewer. The system allowed an asset-level subproblem to consume the run while the only meaningful product counter—new complete maps—remained at zero.

## Contributing causes

### The contract moved during production

The successful EW artifact depended on undocumented/ad-hoc worker transformations. Later implementation tried to make that path deterministic, but direct generation, deterministic finishing, and historical recovery semantics were all present during the same wave. Candidate success depended on which contract interpretation was current.

### Target semantics contradicted each other

“Named target,” “seam contact,” “terminal cross-section,” “cap center,” and “maximum continuation” were not one stable concept. The approved EW baseline and the later NS prompt/validator encode materially different expectations. We generated before proving that the new validator accepted the reference family and expressed the renderer's actual seam requirement.

### The validator did not fail early enough

The `<=8` longitudinal-extent check existed by the checkpoint but v12 publication did not invoke it. A candidate that could have failed deterministically before review instead consumed generation and review effort. At the same time, because the rule conflicts with the approved EW baseline's looser target-neighborhood semantics, merely invoking it earlier would not have solved the underlying contract problem.

### No map-level stop-loss

There was no enforced budget such as “one representative topology family, then one complete map, or stop and reassess.” Six straight-NS rejections and multiple raw/failed artifacts accumulated while the complete-map count stayed unchanged.

### Scope was too broad for the feedback loop

The original goal combined full-game content production, new regional art direction, worker security, deterministic postprocessing, blueprint hardening, runtime integration, catalog activation, and complete-corpus acceptance. All were relevant, but doing them in one persistent loop made it easy for infrastructure work to masquerade as delivery progress.

### Accounting did not use lifecycle states as the primary ledger

File creation and review activity were visible; complete coverage rows and cumulative releases were not kept as the controlling dashboard. The unexplained “3,956 failures” counter made this worse by presenting a large number with no reconciled relationship to Imagegen calls, asset candidates, reviews, failed tool runs, or map attempts.

### The integration boundary remained stale

Approved descriptor work did not become a compiled, archived runtime art release with a synchronized frontend bundle, render profile, compile recipe, map approval, and catalog entry. The expected stale-bundle failure was deferred rather than resolved in a thin vertical slice.

## What went well

- The initial Borderwood map, immutable historical releases, and active release pin were preserved.
- No runtime V3 feature flag, environment activation gate, client downgrade, or capacity-based V2 fallback was introduced.
- The npm lifecycle remained the entry point for generation; the main agent did not bypass it to drop generated files into runtime locations.
- Candidate provenance became much stronger: content-addressed raw artifacts,
  derivations, hashes, review decisions, and failure records were preserved.
  Review records also pin prompt and worker-log identities, although ignored
  candidate directories mean those log bytes are not all included in this
  checkpoint commit.
- Reviewers rejected visually or topologically unsafe candidates rather than approving them to maintain momentum.
- The v11 and v12 straight-NS candidates have concrete immutable rejection reasons, and no retry was authorized after v12.
- Heartlands art direction is explicit and regionally distinct, and 39 families reached asset approval.
- Lifecycle tests and worker-boundary checks found real determinism, isolation, stale-pin, and publication risks that matter before scaling generation.

## What failed

- We did not deliver any additional complete map.
- We counted asset and tooling motion without making the map/release boundary the controlling milestone.
- We changed generation and validation semantics during the wave.
- We accepted the EW artifact without first extracting its ad-hoc steps into a reproducible, reference-validated production contract.
- We generated NS candidates before proving that one coherent contract accepted both the renderer's needs and the approved EW baseline.
- We allowed a deterministic validator to be bypassed in publication and simultaneously left its semantics inconsistent with approved content.
- We did not keep candidate status, review authority, descriptor status, runtime bundle state, and release state fully synchronized.
- We cannot account for the user-reported “3,956 failures” figure from tracked evidence.
- We did not reach the required full test, binary-evidence, matrix, or independent final-release acceptance because there was no final release to accept.

## Impact and waste

The direct impact is that supported non-Borderwood encounters still lack the promised V3 catalog coverage and must remain on the migration compatibility path where eligible V3 content is absent.

The principal waste was not the rejected art by itself; rejection is expected in a reviewed image workflow. The waste came from repeating generation and review while the acceptance contract was moving, expanding hardening work without completing a thin vertical map slice, and leaving large dirty-tree state that is harder to audit and resume than a sequence of verified releases.

Some output remains valuable: approved Heartlands art, a source-approved Heartlands template, stronger lifecycle code/tests, and immutable negative examples. But none should be valued as a partial map or used to claim coverage. Recovery must treat it as checkpoint material requiring revalidation, not as an almost-complete release.

## Lessons

1. A map program must count complete maps and coverage rows, not images, descriptors, files, tests, or goal-loop events.
2. Freeze and reference-test the asset contract before live generation. A validator is not authoritative until the approved baseline and renderer seam behavior agree with it.
3. One successful hand-finished asset is evidence for visual direction, not evidence that the workflow scales.
4. Infrastructure hardening needs its own bounded acceptance criteria and change window. Do not redesign the production line inside an active content wave.
5. Every candidate decision must transition all authoritative state consistently; an immutable rejection and `candidate-awaiting-review` metadata must not coexist without an explicit archived-state explanation.
6. Complete one thin vertical slice—art bundle through active catalog—before expanding a regional family or theme.
7. Every reported counter must have a documented unit, source, and reconciliation to immutable lifecycle records.
8. A persistent goal still needs stop-loss criteria. Persistence should continue a validated process, not repeat an unresolved contradiction.

## Recovery recommendations if work resumes

No further generation should occur from the current state until the following recovery sequence is completed:

1. **Freeze the checkpoint.** Preserve the dirty-tree evidence, especially the v11/v12 reviews, seven straight-NS raw artifacts, five failed-attempt records, current hashes, and original goal snapshot. Do not normalize, replace, approve, or regenerate the rejected v11/v12 bytes.
2. **Reconcile the ledger.** Produce one machine-readable table whose rows are candidate attempt, Imagegen invocation, publication result, review decision, descriptor state, compiled asset, map, approval, and release. Define or remove the “3,956 failures” metric.
3. **Choose one route contract.** Decide whether route production uses direct whole-image normalization or deterministic finishing. Remove the other from the active contract rather than leaving per-descriptor ambiguity.
4. **Define seam semantics once.** Specify named target, seam cross-section, allowable cap, visible overflow, alpha threshold, and width samples in renderer terms. Use one vocabulary in descriptors, prompts, validators, docs, and reviews.
5. **Test against approved baselines before generation.** Run the proposed longitudinal and transverse validators against the approved Heartlands EW source and representative Borderwood route assets. Either the baselines pass for the right reasons or a reviewed successor contract/version is created; do not silently grandfather contradictory geometry.
6. **Make deterministic checks pre-publication.** A candidate that violates extent, topology, alpha, size, provenance, or bundle rules must fail before it becomes reviewable.
7. **Resolve the current NS state without generating.** Mark the current v12 candidate coherently rejected/archived, verify its bytes against the immutable review, leave the descriptor draft, and require an explicit new content version for any future candidate.
8. **Finish one Heartlands vertical slice.** Complete only the minimum asset set actually exercised by one `forest-template-03` blueprint; approve that blueprint; compile, render, inspect, and approve one map; compile/archive the exact art bundle and frontend mirror; build a cumulative catalog release; run binary and deterministic selection checks; activate through the tracked pin.
9. **Stop if the slice does not close.** If one representative map cannot reach catalog activation under the frozen contract, return to contract design. Do not expand to another topology, template, ecology, tier, or theme.
10. **Scale by verified release waves.** Only after that map is active should the remaining two template layouts, then another ecology, then another theme be scheduled. Each wave must end in completed coverage rows and an immutable cumulative release.

## Current checkpoint

- **Complete active maps:** one, the initial Borderwood `forest-template-01-b@12`.
- **Additional complete maps from the follow-on:** zero.
- **Template state:** templates 01 and 02 are already blueprint-pinned in the baseline; dirty-tree template 03 is semantically/source approved but has no approved blueprint hash.
- **Heartlands art plan:** 43 descriptor families across tier bands 1–5.
- **Heartlands asset state:** 39 approved descriptors and four drafts; no new compiled Heartlands runtime bundle/release.
- **Battle-art reviews:** 92 immutable records total: 40 approved and 52 rejected.
- **Straight-NS:** six rejected reviews, no approved review, seven preserved raw PNGs, five preserved failed-attempt JSONs; v11 and v12 rejected; no further generation.
- **Catalog/activation:** unchanged r6 active release with the one Borderwood entry.
- **Acceptance:** full-game coverage, complete corpus, final binary evidence, and final independent release review remain incomplete.

This checkpoint is recoverable only if the next session treats the complete map release as the unit of progress and first resolves the contract and accounting failures without generating another image.
