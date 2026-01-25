# Marketplace Item Augments Integration Design

**Date:** 2026-01-11
**Status:** Approved
**Author:** Claude + User Collaboration

## Overview

Extend the marketplace to display and trade items with their full procedurally-generated properties (augments, bonus stats, materials, generated names).

### Problem Statement

The item generation system creates rich, unique items with augments, materials, and bonus stats. However, the marketplace treats all items of the same template as identical commodities. A "Divine Blazing Celestial Staff of Wisdom" appears as just "Mystic Staff" in listings, with no way to see or search for augmented items.

### Solution: Hybrid Browse-and-Select

Players browse at the template level for quick scanning, then drill into a side panel to see individual item variants and make informed purchases.

```
Browse Templates → Click Template → Side Panel Shows Variants → Select Specific Item → Purchase
     ↓                                      ↓
  Filter by:                          Shows for each:
  - Item type                         - Full generated name
  - Augment category                  - All augments with effects
  - Price range                       - Bonus stats
                                      - Material & rarity
                                      - Seller's asking price
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Item uniqueness handling | Hybrid (template + drill-down) | Best of both: easy browsing, informed purchasing |
| Item detail display | Side panel preview | Matches existing UI patterns, doesn't interrupt flow |
| Search/filter capability | Augment type filter | Practical without overwhelming casual players |
| Seller pricing | Suggested price with override | Helps new players, veterans can adjust |
| Price calculation | Formula-based | Works from day one, predictable, transparent |
| Information density | Minimal template, rich detail | Clean browse view, full info on demand |
| Consumable handling | Same hybrid system | Consistent experience, premium consumables can be priced accordingly |

## Backend Changes

### New Endpoint: `GET /api/marketplace/items/:templateId`

Returns all available listings for a specific template with full modification data:

```javascript
{
  templateId: 5,
  templateName: "Mystic Staff",
  listings: [
    {
      listingId: 123,
      generatedName: "Divine Blazing Celestial Mystic Staff of Wisdom",
      rarity: "legendary",
      material: "celestial",
      baseStats: { intelligence: 37, mp_max: 74 },
      bonusStats: { strength: 8, agility: 12 },
      augments: [
        { name: "Blazing", type: "prefix", effect: { type: "fire_damage", value: 0.10 } },
        { name: "of Wisdom", type: "suffix", effect: { type: "stat_bonus", stat: "intelligence" } }
      ],
      askPrice: 5000,
      suggestedPrice: 4200,
      sellerId: 42,
      sellerName: "DragonSlayer99"
    }
  ]
}
```

### Modified: `GET /api/marketplace/search`

Add optional `augmentCategory` filter parameter:
- Joins `marketplace_listings` → `character_items` → parse `modifications` JSONB
- Filters where any augment matches requested category (fire, ice, strength, etc.)

### New: Price Suggestion Helper

```javascript
function calculateSuggestedPrice(item) {
  const rarityMult = { common: 1, uncommon: 1.5, rare: 2.5, epic: 5, legendary: 10 };
  const augmentValue = item.augments.reduce((sum, aug) => sum + getAugmentValue(aug), 0);
  return Math.floor(item.basePrice * rarityMult[item.rarity] * (1 + augmentValue * 0.1));
}

// Augment values by category:
// - Elemental (fire, ice, etc.): 0.8
// - Stat bonus (strength, etc.): 1.0
// - Enemy-slayer (dragonbane): 1.2
// - Consumable effects: 0.5 - 1.5 based on effect
```

## Frontend Changes

### Template Card (Browse View)

Minimal display with aggregate info:

```
┌─────────────────────────┐
│ 🗡️ Iron Sword          │
│ Weapon • 5 available    │
│ 150 - 2,400 gold        │
│ [Common to Epic]        │
└─────────────────────────┘
```

### Side Panel (Item Variants)

Opens when template is clicked, reuses `InventoryPanel` patterns:

```
┌─────────────────────────────────────┐
│ Iron Sword (5 available)        [X] │
├─────────────────────────────────────┤
│ ⚔️ Superior Blazing Steel Sword     │
│    of Fortitude                     │
│    Rare • Steel                     │
│    +12 STR, +8 VIT                  │
│    🔥 +10% fire damage              │
│    🛡️ +12 VIT (augment)             │
│    ───────────────────              │
│    💰 850 gold  [BUY]               │
├─────────────────────────────────────┤
│ ⚔️ Fine Bronze Sword                │
│    Uncommon • Bronze                │
│    +5 STR                           │
│    ───────────────────              │
│    💰 180 gold  [BUY]               │
└─────────────────────────────────────┘
```

### Filter Bar Addition

Add augment category dropdown alongside existing filters:

```
[Search...] [Type ▼] [Augment ▼] [Sort ▼]
                      ├─ Any
                      ├─ Fire
                      ├─ Ice
                      ├─ Strength
                      ├─ Defense
                      └─ ...
```

### Code Reuse from InventoryPanel

- `formatAugmentEffect()` method
- Augment display styles (`.bonus-stat`, `.augment-effect`)
- Rarity color classes
- Parchment theme colors

## Seller Experience

### Enhanced Listing Dialog

```
┌─────────────────────────────────────────┐
│ List Item for Sale                      │
├─────────────────────────────────────────┤
│ ⚔️ Superior Blazing Steel Sword         │
│    of Fortitude                         │
│    Rare • Steel                         │
│    +12 STR, +8 VIT                      │
│    🔥 +10% fire damage                  │
│    🛡️ +12 VIT (augment)                 │
├─────────────────────────────────────────┤
│ Suggested Price: 850 gold               │
│ (Base 100 × 2.5 rare × 1.4 augments)    │
│                                         │
│ Your Price: [____850____] gold          │
├─────────────────────────────────────────┤
│        [CANCEL]     [LIST FOR SALE]     │
└─────────────────────────────────────────┘
```

### Price Formula

```
suggestedPrice = basePrice × rarityMultiplier × augmentMultiplier

rarityMultiplier:
  common: 1.0, uncommon: 1.5, rare: 2.5, epic: 5.0, legendary: 10.0

augmentMultiplier:
  1.0 + (prefixValue + suffixValue) × 0.15
```

## Database & Data Flow

### No Schema Changes Required

The existing infrastructure supports this design:
- `character_items.modifications` JSONB already stores all augment data
- `marketplace_listings` links to `character_items` via item reference
- Just need to JOIN and expose the data

### Key Queries

**Template aggregation (browse view):**
```sql
SELECT
  it.id, it.name, it.item_type,
  COUNT(ml.id) as available_count,
  MIN(ml.price) as min_price,
  MAX(ml.price) as max_price
FROM item_templates it
JOIN character_items ci ON ci.item_template_id = it.id
JOIN marketplace_listings ml ON ml.item_id = ci.id
WHERE ml.status = 'active'
GROUP BY it.id, it.name, it.item_type
```

**Individual items (side panel):**
```sql
SELECT
  ml.id as listing_id, ml.price,
  ci.modifications,
  it.name as template_name,
  u.username as seller_name
FROM marketplace_listings ml
JOIN character_items ci ON ml.item_id = ci.id
JOIN item_templates it ON ci.item_template_id = it.id
JOIN users u ON ml.seller_id = u.id
WHERE ci.item_template_id = $1 AND ml.status = 'active'
ORDER BY ml.price ASC
```

**Augment filter:**
```sql
WHERE ci.modifications->'augments' @> '[{"category": "fire"}]'
```

## Implementation Phases

### Phase 1: Backend API (Foundation)
- Add `GET /api/marketplace/items/:templateId` endpoint
- Modify search to include modifications data
- Add `augmentCategory` filter parameter
- Implement price suggestion helper

### Phase 2: Frontend Side Panel
- Create `MarketplaceItemPanel` component
- Reuse InventoryPanel's augment display code
- Wire up template click → panel open
- Add buy button with item-specific purchase

### Phase 3: Enhanced Browse View
- Update template cards with price range, count, rarity range
- Add augment category dropdown filter
- Update search to use new filter parameter

### Phase 4: Seller Enhancements
- Show full item details in listing dialog
- Display suggested price with formula breakdown
- Pre-fill price input with suggestion

### Estimated Scope

| Phase | Files Changed | Complexity |
|-------|--------------|------------|
| Phase 1 | 2-3 backend | Medium |
| Phase 2 | 1-2 frontend | Medium |
| Phase 3 | 1 frontend | Low |
| Phase 4 | 1-2 frontend | Low |

**Dependencies:** Phase 2-4 depend on Phase 1. Phases 2-4 can be parallelized after Phase 1.

## Files to Modify

| File | Changes |
|------|---------|
| `api/src/routes/marketplace.js` | Add items endpoint, modify search |
| `api/src/services/marketplaceService.js` | Add item query, price suggestion |
| `frontend/src/scenes/MarketplaceScene.js` | Side panel, filter bar, template cards |
| `frontend/src/components/MarketplaceItemPanel.js` | New component for item variants |

## Success Criteria

1. Buyers can see full generated names and augments before purchasing
2. Buyers can filter marketplace by augment category
3. Sellers see suggested prices based on item quality
4. Sellers can set custom prices with full item details visible
5. Consumables and equipment use the same consistent system
