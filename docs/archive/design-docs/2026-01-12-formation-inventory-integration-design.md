# Formation & Inventory Integration Design

## Document Information

| Field | Value |
|-------|-------|
| Created | January 12, 2026 |
| Status | Approved |
| Priority | High |
| Category | UX/UI, Feature Consolidation |

---

## Overview

Redesign FormationScene to be the unified party management hub, eliminating the separate InventoryScene. All party, equipment, item, and skill management happens through a modal-based interface within a single scene.

### Goals

1. **Simplify navigation** - Remove redundant Inventory scene
2. **Improve discoverability** - All party management in one place
3. **Better mobile UX** - Modal stacking works well on touch devices
4. **Consistent patterns** - DataTable and modal patterns throughout

### Non-Goals

- Item discard functionality (sell at shop instead)
- Drag-to-reorder party slots (backend-managed)
- Keyboard navigation (deferred)

---

## Architecture

### Modal Stacking Pattern

```
FormationScene (base view)
├── Items Modal (L1)
│   └── Item Detail Modal (L2)
│       └── Character Picker (inline component)
│
└── Character Modal (L1)
    ├── Equipment Slot Modal (L2)
    └── Skill Detail Modal (L2)
```

All modals use `ParchmentModal` component which already supports z-index stacking.

### Scene Layout

```
┌────────────────────────────────────────────────────────┐
│ Party Formation                   [Items]    [← Back]  │
├────────────────────────────────────────────────────────┤
│ 2W 1M 1Monk 1C │ Avg Lv 8 │ Power 1250 │ 3 SP avail   │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐       │
│  │  Card  │  │  Card  │  │  Card  │  │  Card  │       │
│  │  🔴🟡  │  │        │  │  🟡    │  │        │       │
│  └────────┘  └────────┘  └────────┘  └────────┘       │
│                                                        │
│  ┌────────┐  ┌────────┐                                │
│  │  Card  │  │  Card  │                                │
│  └────────┘  └────────┘                                │
│                                                        │
└────────────────────────────────────────────────────────┘

Legend:
🔴 = Equipment upgrade available
🟡 = Skill points to spend
```

### Responsive Breakpoints

| Breakpoint | Grid Columns | Card Size |
|------------|--------------|-----------|
| Desktop    | 4            | 160px     |
| Tablet     | 3            | 140px     |
| Mobile     | 2            | Full-width|

---

## Components

### New Components to Create

#### 1. CharacterCard.js

Parchment-styled card for party grid.

```javascript
// Props
{
  character: {
    id, name, level, className,
    currentHp, maxHp, currentMp, maxMp
  },
  badges: {
    hasEquipmentUpgrade: boolean,
    hasSkillPoints: boolean
  },
  onClick: (characterId) => void,
  selected: boolean
}

// Display
- Portrait area (class icon with colored background)
- Name (truncated if long)
- Level badge
- Class name
- HP bar (condensed)
- Badge indicators (corner dots)
```

#### 2. PartyStatsSummary.js

Horizontal summary bar below header.

```javascript
// Props
{
  characters: Character[],
  totalSkillPoints: number
}

// Display
- Class composition (icon counts: "2W 1M 1Mk 1C")
- Average level
- Total party power (sum of all stats or calculated rating)
- Skill points indicator (if > 0)
```

#### 3. ItemsModal.js

Full inventory view modal.

```javascript
// Props
{
  onClose: () => void
}

// Content
- ItemDataTable with variant='inventory'
- Filters: search, type, rarity
- Click row → opens ItemDetailModal
- Empty state: "Your party has no items"
```

#### 4. ItemDetailModal.js

Item details and actions.

```javascript
// Props
{
  item: InventoryItem,
  onClose: () => void,
  onItemUsed: () => void
}

// Display
- Large item icon
- Name with rarity color
- Type and rarity badges
- Full description
- Stats table (base + bonus)
- Augment list with effects

// Actions
- Consumables: [Use] → opens CharacterPicker inline
- Equipment: No action (view only)
```

#### 5. CharacterPicker.js

Inline character selection for consumable targeting.

```javascript
// Props
{
  characters: Character[],
  onSelect: (characterId) => void,
  validTargets?: (char) => boolean // e.g., damaged chars for healing
}

// Display
- Grid of character mini-cards
- Name, level, class, current HP%
- Highlight valid targets
- Dim invalid targets
```

#### 6. CharacterModal.js

Character detail view with accordion sections.

```javascript
// Props
{
  characterId: number,
  onClose: () => void
}

// Sections
1. Equipment Accordion
   - DataTable with equipment slot rows
   - Click row → EquipmentSlotModal
   - [Quick Equip Best] button

2. Skills Accordion
   - Skill tree visualization
   - Click skill → SkillDetailModal
```

#### 7. Accordion.js

Collapsible panel component.

```javascript
// Props
{
  id: string,          // For state persistence
  title: string,
  defaultOpen: boolean,
  badge?: string,      // e.g., "3 points"
  children: ReactNode
}

// Features
- Animated expand/collapse (CSS transitions)
- State persistence via localStorage keyed by id
- Header click toggles
- Chevron rotation indicator
```

#### 8. EquipmentSlotModal.js

Equipment management for a single slot.

```javascript
// Props
{
  characterId: number,
  slotName: string,    // 'head', 'body', 'main_hand', etc.
  currentItem: Item | null,
  onClose: () => void,
  onEquipmentChanged: () => void
}

// Sections
1. Currently Equipped
   - Full item detail (or "Empty" placeholder)
   - [Unequip] button

2. Available Items
   - ItemDataTable filtered by slot + class eligibility
   - Stat comparison column (vs current)
   - Click row → show detail + [Equip] button
```

#### 9. SkillDetailModal.js (Revamped)

Complete skill information and level-up.

```javascript
// Props
{
  characterId: number,
  skill: Skill,
  availableSkillPoints: number,
  onClose: () => void,
  onSkillLevelUp: () => void
}

// Sections
1. Header
   - Large skill icon
   - Name and category
   - Current level / Max level

2. Overview
   - Full description
   - Unlock status badge

3. Stats at Current Level
   - Damage/healing
   - MP cost
   - Cooldown
   - Range/area
   - Special effects

4. Level Progression Table
   | Level | Damage | MP | Cooldown | Special |
   |-------|--------|-------|----------|---------|
   | 1     | 20     | 5     | 2        | -       |
   | 2*    | 35     | 5     | 2        | -       |
   | 3     | 50     | 4     | 2        | Burn    |
   (* = current level highlighted)

5. Prerequisites
   - Required character level
   - Required skills (with status)
   - Mini tree visualization

6. Comparison Panel
   - Compare vs similar skills
   - DPS/efficiency metrics

7. Action
   - [Level Up] button (cost: X skill points)
   - Disabled with reason if not available
```

### DataTable Enhancements

#### New Column: statComparison

Shows stat deltas comparing item to a reference.

```javascript
// Column config
{
  key: 'statComparison',
  label: 'vs Current',
  width: '100px',
  sortable: false,
  renderer: (item, options) => {
    const current = options.compareItem;
    // Return "+5 STR, -2 DEF" style HTML
  }
}

// Usage
new ItemDataTable(container, {
  columns: [..., 'statComparison'],
  compareItem: currentlyEquippedItem
});
```

#### New Variant: equipment-slots

For displaying character equipment in CharacterModal.

```javascript
COLUMN_PRESETS['equipment-slots'] = [
  'slot',           // Head, Body, Main Hand, etc.
  'equippedItem',   // Icon+name or "Empty"
  'itemStats'       // Key stats preview
];

// Row data structure
{
  slotKey: 'main_hand',
  slotName: 'Main Hand',
  item: { ... } | null,
  itemStats: '+15 ATK, +5 STR'
}
```

---

## Data Flow

### Items Modal Flow

```
User clicks [Items] button
  → ItemsModal opens
  → Fetch: GET /api/inventory/shared
  → Render ItemDataTable

User clicks item row
  → ItemDetailModal opens (L2)
  → Display item details

User clicks [Use] (consumable)
  → CharacterPicker appears
  → User selects character
  → POST /api/inventory/use
  → Toast: "Restored 50 HP to Aldric"
  → Refresh inventory
  → Close ItemDetailModal
```

### Equipment Flow

```
User clicks character card
  → CharacterModal opens
  → Fetch: GET /api/inventory/:characterId (equipped)
  → Fetch: GET /api/characters/:characterId/skills
  → Render accordions

User clicks equipment slot row
  → EquipmentSlotModal opens (L2)
  → Fetch: GET /api/inventory/shared (for available items)
  → Filter by slot compatibility + class eligibility
  → Render with stat comparison

User clicks [Equip] on available item
  → POST /api/inventory/equip
  → Toast: "Equipped Iron Sword"
  → Close EquipmentSlotModal
  → Refresh CharacterModal equipment
```

### Skill Level-Up Flow

```
User clicks skill in accordion
  → SkillDetailModal opens (L2)
  → Display skill details

User clicks [Level Up]
  → POST /api/skills/:characterId/levelup
  → Toast: "Fireball upgraded to level 3"
  → Close SkillDetailModal
  → Refresh CharacterModal skills
  → Update party summary (skill points)
```

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /api/characters | Load party data |
| GET | /api/inventory/shared | Party inventory |
| GET | /api/inventory/:charId | Character equipped items |
| POST | /api/inventory/equip | Equip item to character |
| POST | /api/inventory/unequip | Unequip item |
| POST | /api/inventory/use | Use consumable |
| GET | /api/skills/:charId | Character skills |
| POST | /api/skills/:charId/levelup | Level up skill |

---

## Cleanup Tasks

### Files to Delete

- `frontend/src/scenes/InventoryScene.js`
- `frontend/src/components/InventoryPanel.js`

### Navigation Updates

- Remove "Inventory" from WorldMapScene menu
- Remove from ProfileDropdown if present
- Remove from any scene transition references

### FormationScene Cleanup

- Remove "Slots 1-5 are your battle party" text
- Remove right-side detail panel
- Remove Stats/Equipment/Skills tabs

---

## Extra Features

### Character Card Badges

Visual indicators on cards:

| Badge | Color | Condition |
|-------|-------|-----------|
| Equipment upgrade | Red dot | Inventory has better item for any slot |
| Skill points | Yellow dot | Character has unspent skill points |

**Calculation for equipment badge:**
```javascript
// For each equipment slot
const currentStats = currentItem?.totalStats || 0;
const bestAvailable = inventory
  .filter(item => isEquippableInSlot(item, slot, character))
  .sort((a, b) => b.totalStats - a.totalStats)[0];

if (bestAvailable?.totalStats > currentStats) {
  showUpgradeBadge = true;
}
```

### Quick Equip Best

Auto-equip optimal items for character.

```javascript
async function quickEquipBest(characterId) {
  const inventory = await getSharedInventory();
  const character = await getCharacter(characterId);

  const slots = ['head', 'body', 'main_hand', 'off_hand', 'legs', 'feet', 'accessory'];

  for (const slot of slots) {
    const eligible = inventory
      .filter(item => canEquip(item, slot, character.className))
      .sort((a, b) => calculatePower(b) - calculatePower(a));

    if (eligible[0]) {
      await equipItem(eligible[0].instanceId, characterId, slot);
    }
  }
}
```

**UI:**
- Button in CharacterModal equipment section
- Confirmation dialog: "Auto-equip best items for [Character]?"
- Toast on completion: "Equipped 4 items"

---

## Accordion State Persistence

Context-dependent default states:

```javascript
function getAccordionDefaultState(characterId, accordionType) {
  // Check localStorage first
  const stored = localStorage.getItem(`accordion:${characterId}:${accordionType}`);
  if (stored !== null) return stored === 'true';

  // Context-dependent defaults
  if (accordionType === 'equipment') {
    return hasEquipmentUpgrade(characterId); // Open if upgrades available
  }
  if (accordionType === 'skills') {
    return hasSkillPoints(characterId); // Open if points to spend
  }
  return true; // Default open
}
```

---

## Testing Plan

### Manual Testing Checklist

#### Formation Grid
- [ ] Load with 1-12 characters
- [ ] Verify responsive grid (4/3/2 columns)
- [ ] Verify badges show correctly
- [ ] Click card -> modal opens
- [ ] Party stats summary updates

#### Items Modal
- [ ] Open via Items button
- [ ] All inventory items display
- [ ] Filters work (search, type, rarity)
- [ ] Click item -> detail modal
- [ ] Use consumable with character picker
- [ ] Verify item consumed and inventory refreshed

#### Character Modal
- [ ] Opens with correct character data
- [ ] Accordions expand/collapse
- [ ] Accordion states persist (refresh and check)
- [ ] Equipment rows show correct data
- [ ] Skills display correctly

#### Equipment Management
- [ ] Click slot -> modal shows current + available
- [ ] Only compatible items shown
- [ ] Stat comparison indicators correct
- [ ] Equip works and refreshes
- [ ] Unequip works and refreshes
- [ ] Quick Equip Best functions

#### Skills
- [ ] Skill detail shows all info
- [ ] Progression table accurate
- [ ] Level Up with available points
- [ ] Level Up disabled without points
- [ ] Prerequisites shown correctly

#### Navigation Cleanup
- [ ] Inventory removed from all menus
- [ ] No broken links to InventoryScene
- [ ] Back button returns to WorldMap

### Automated Tests

- [ ] DataTable: Tests for new columns/variants
- [ ] API: Equip/unequip/use-item endpoint tests
- [ ] Integration: Equipment swap flow test

---

## Implementation Order

### Phase 1: Foundation (Components)

1. Accordion.js
2. CharacterCard.js
3. PartyStatsSummary.js
4. CharacterPicker.js

### Phase 2: DataTable Enhancements

1. Add statComparison column
2. Add equipment-slots variant
3. Verify backward compatibility (run Shop/Marketplace tests)

### Phase 3: Modals

1. ItemsModal.js
2. ItemDetailModal.js
3. CharacterModal.js (basic, without accordion content)
4. EquipmentSlotModal.js
5. SkillDetailModal.js

### Phase 4: FormationScene Redesign

1. New layout structure
2. Character grid with CharacterCard
3. Party stats summary bar
4. Items button -> ItemsModal
5. Character click -> CharacterModal
6. Remove old elements

### Phase 5: Extra Features

1. Character card badges
2. Quick Equip Best
3. Accordion state persistence

### Phase 6: Cleanup

1. Delete InventoryScene.js
2. Delete InventoryPanel.js
3. Update navigation menus
4. Update scene transitions

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Modal z-index conflicts | Medium | Low | ParchmentModal handles stacking |
| Performance with 12 characters | Low | Low | Cards are lightweight components |
| Breaking Shop/Marketplace | High | Low | DataTable changes are additive |
| Complex state management | Medium | Medium | Each modal manages own state |
| Mobile scrolling issues | Medium | Medium | Test thoroughly on touch devices |

---

## Success Criteria

- [ ] InventoryScene fully eliminated
- [ ] All inventory actions available via FormationScene
- [ ] No regression in Shop/Marketplace
- [ ] Responsive on mobile/tablet/desktop
- [ ] Accordion states persist correctly
- [ ] Character badges show accurate info
- [ ] Quick Equip Best works correctly
- [ ] All tests pass
