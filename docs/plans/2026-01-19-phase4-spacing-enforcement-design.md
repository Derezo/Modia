# Phase 4 Internal Connection Spacing Enforcement

**Date:** 2026-01-19
**Status:** Planning
**Scope:** Add max spacing constraint (13.3 units / 400px) to Phase 4 internal connections
**Related:** Phase 5 spacing enforcement (completed 2026-01-19)

## Problem Statement

Phase 4 (`internalConnections.js`) creates connections within each region using MST + extra connections. Currently, **320 connections exceed the 13.3-unit max spacing constraint**, causing visual gaps on the world map where nodes appear disconnected.

Phase 5 (inter-region connections) now enforces max spacing via `enforceSpacingForConnection()` and gap infill with intermediate nodes. Phase 4 needs similar treatment.

## Current Behavior Analysis

### File: `api/src/db/worldgen/internalConnections.js`

#### Key Functions and Their Spacing Behavior

| Function | Purpose | Current Spacing Behavior | Violations? |
|----------|---------|-------------------------|-------------|
| `buildRegionMST()` | Creates base connectivity tree using Prim's algorithm | No max distance constraint - picks nearest unvisited node regardless of distance | **YES** |
| `addExtraConnections()` | Adds 20% more connections for route variety | Uses `MAX_CONNECTION_DISTANCE: 12` filter, but 12 < 13.3 so not the issue | No |
| `ensureMinimumConnections()` | Ensures nodes meet min connection requirements | Picks nearest valid candidate without any distance limit | **YES** |

#### Root Cause: MST Algorithm

```javascript
// buildRegionMST() - lines 113-170
function buildRegionMST(nodes, castle, rng) {
  // Prim's algorithm: always picks the nearest unvisited node
  // No max distance constraint - if nearest node is 20 units away, still connects

  while (unvisited.size > 0) {
    let bestEdge = null;
    let bestCost = Infinity;

    for (const visitedIdx of visited) {
      for (const unvisitedIdx of unvisited) {
        const cost = distance(nodes[visitedIdx], nodes[unvisitedIdx]);
        if (cost < bestCost) {  // Pure distance comparison, no max check
          bestCost = cost;
          bestEdge = { from: visitedIdx, to: unvisitedIdx };
        }
      }
    }
    // ... adds edge regardless of distance
  }
}
```

#### Root Cause: Minimum Connection Enforcement

```javascript
// ensureMinimumConnections() - lines 282-340
function ensureMinimumConnections(nodes, connections, connectionMap) {
  // Finds nearest valid candidate without distance limit
  const candidates = [];
  for (let j = 0; j < nodes.length; j++) {
    if (i !== j && !connectionMap[i].has(j)) {
      const dist = distance(nodes[i], nodes[j]);
      // No max distance check here
      if (isValidConnection(nodes[i], nodes[j])) {
        candidates.push({ index: j, distance: dist });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  // Picks nearest candidate even if very far away
}
```

### CONNECTION_CONFIG (lines 12-25)

```javascript
export const CONNECTION_CONFIG = {
  EXTRA_CONNECTION_RATIO: 0.2,      // 20% extra connections beyond MST
  MAX_CONNECTION_DISTANCE: 12,       // Only used in addExtraConnections()
  MIN_CONNECTIONS: {
    castle: 4,
    city: 3,
    village: 2,
    // ... etc
  },
  MAX_CONNECTIONS: {
    bridge: 2,
    // ... etc
  }
};
```

**Note:** `MAX_CONNECTION_DISTANCE: 12` is only enforced in `addExtraConnections()`, not in MST or minimum connection enforcement.

## Why MST Creates Long Connections

MST (Minimum Spanning Tree) guarantees all nodes are connected with minimum total edge weight. However:

1. **Sparse regions**: If a region has few nodes spread far apart, MST must create long edges
2. **Outlier nodes**: Terminators and frontier nodes at Ring 3 may be far from the nearest visited node
3. **No alternative**: MST has no choice - it must connect every node, even distant ones

### Example Scenario

```
Castle at (0, 0)
City at (5, 5)
Terminator at (18, 3)  <- Very far from other nodes

MST must connect Terminator. Nearest node might be 15 units away.
No intermediate nodes exist to bridge the gap.
```

## Proposed Solution

### Option A: Gap Infill (Recommended)

Similar to Phase 5's approach - when a connection exceeds max spacing, insert intermediate battle nodes along the path.

**Pros:**
- Consistent with Phase 5 implementation
- Preserves MST connectivity guarantee
- Fills visual gaps naturally

**Cons:**
- Increases total node count (~50-100 new nodes estimated)
- Must update ring distances for new nodes
- Must handle terrain assignment for intermediates

### Option B: Distance-Constrained MST

Modify MST to skip candidates beyond max distance, then handle disconnected subgraphs separately.

**Pros:**
- No extra nodes created

**Cons:**
- Complex disconnected subgraph handling
- May create unnatural connection patterns
- Harder to guarantee full connectivity

### Option C: Post-MST Gap Enforcement

Run MST as-is, then iterate over all connections and split long ones with intermediates.

**Pros:**
- Minimal changes to MST algorithm
- Clear separation of concerns

**Cons:**
- Essentially same as Option A but different code structure

## Implementation Plan (Option A)

### Step 1: Add Gap Infill Function

Reuse or adapt `generateIntermediateNodes()` from `interRegionConnections.js`:

```javascript
// New function in internalConnections.js
function createIntermediateNode(x, y, region, rng) {
  const terrain = assignBattleNodeTerrain(region, rng);
  return {
    x,
    y,
    nodeType: terrain,
    regionId: region.id,
    regionName: region.name,
    regionRace: region.race,
    ringDistance: null,  // Will be calculated later
    difficulty: null,    // Will be calculated later
    isIntermediateNode: true,
    name: `${region.name} Path`
  };
}
```

### Step 2: Modify buildRegionMST()

After adding each edge, check distance and insert intermediates if needed:

```javascript
function buildRegionMST(nodes, castle, rng, region) {
  const intermediateNodes = [];
  const MAX_SPACING = INTER_REGION_CONFIG.MAX_NODE_SPACING; // 13.3

  while (unvisited.size > 0) {
    // ... existing best edge selection ...

    const dist = distance(nodes[bestEdge.from], nodes[bestEdge.to]);
    if (dist > MAX_SPACING) {
      // Insert intermediate nodes
      const numIntermediates = Math.ceil(dist / MAX_SPACING) - 1;
      // ... create intermediate nodes and chain connections ...
    } else {
      connections.push(bestEdge);
    }

    visited.add(bestEdge.to);
    unvisited.delete(bestEdge.to);
  }

  return { connections, intermediateNodes };
}
```

### Step 3: Update ensureMinimumConnections()

Add distance check or gap infill when connecting distant nodes:

```javascript
// Filter candidates by max distance OR be prepared to add intermediates
const MAX_SPACING = INTER_REGION_CONFIG.MAX_NODE_SPACING;
const nearbyCandidates = candidates.filter(c => c.distance <= MAX_SPACING);

if (nearbyCandidates.length > 0) {
  // Use nearby candidate
} else {
  // Must use distant candidate - add intermediates
}
```

### Step 4: Recalculate Ring Distances

After inserting intermediates, rerun BFS from castle to assign correct ring distances:

```javascript
function recalculateRingDistances(allNodes, connections, castleIndex) {
  // BFS from castle, counting hops
  // Update ringDistance for all nodes including intermediates
}
```

### Step 5: Update Validation

`validatePhase4()` should now check for spacing violations and flag them.

## Files to Modify

| File | Changes |
|------|---------|
| `api/src/db/worldgen/internalConnections.js` | Add gap infill logic to MST and min connections |
| `api/src/db/worldgen/constants.js` | May need to import `INTER_REGION_CONFIG.MAX_NODE_SPACING` |
| `api/src/db/worldgen/validation.js` | Add Phase 4 spacing validation |

## Estimated Impact

- **Node count increase**: ~50-100 intermediate nodes across 5 regions
- **Connection count**: May increase slightly due to chained connections
- **Ring distances**: Intermediate nodes will be Ring 2-3 (frontier paths)
- **Generation time**: Minimal impact (O(n) gap check per edge)

## Testing Strategy

1. **Unit test**: Verify `buildRegionMST()` produces no connections > 13.3 units
2. **Unit test**: Verify `ensureMinimumConnections()` handles distant nodes correctly
3. **Integration test**: Run `validatePhase6()` and confirm 0 spacing violations
4. **Visual test**: Inspect WorldMapScene for gaps

## Open Questions

1. Should intermediate nodes have unique names or generic "Path" suffix?
2. Should intermediates count toward region node totals?
3. What terrain should intermediates use - random or lerp between endpoints?
4. Should ring distance be based on graph hops or include intermediates in count?

## References

- Phase 5 implementation: `api/src/db/worldgen/interRegionConnections.js` lines 55-150
- Current validation: `api/src/db/worldgen/validation.js` `validateMaxSpacing()`
- Design doc: `docs/archive/2026-01-13-regional-world-generation-design.md`
