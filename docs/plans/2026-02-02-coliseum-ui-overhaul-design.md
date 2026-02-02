# Coliseum UI Overhaul Design

**Date:** 2026-02-02
**Status:** Approved
**Scope:** Major UI redesign with queue transparency, tier system, and achievement badges

## Overview

Redesign the Coliseum PvP interface to improve queue transparency, replace the aggressive red color scheme with a tactical slate-blue aesthetic, add a visual rank tier system, and introduce achievement badges.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Color Scheme | Slate Arena (steel blue + bronze) |
| Queue Transparency | Full transparency (all player names, ELO, wait times visible) |
| Rank System | Tier badges (Bronze → Grandmaster) |
| Additional Features | Achievement badges |
| Match Found Screen | Enhanced opponent card with stats |

---

## 1. Color Scheme: Slate Arena

Replace the current blood-red (`#ff4444`) theme with a tactical steel-blue aesthetic.

### Color Palette

```javascript
export const ARENA_COLORS = {
  // Primary Accent - Steel Blue
  primary: '#4a6b8a',
  primaryLight: '#5a80a8',
  primaryDark: '#3a556a',

  // Secondary Accent - Bronze
  gold: '#b8956a',
  goldLight: '#caa87a',
  goldDark: '#9a7855',

  // Backgrounds - Cool Stone
  backgroundDark: '#1a2025',
  backgroundMid: '#2a3035',

  // States
  victory: '#5a8c75',       // Muted teal-green
  victoryDark: '#4a7a65',
  defeat: '#8b6a6a',        // Muted dusty rose
  defeatDark: '#7a5a5a',
  readyGreen: '#6aa688',    // Softer green
  readyGreenDark: '#5a9678'
};
```

### Visual Changes
- Title glow: steel-blue instead of red
- Queue cards: bronze accents on hover
- Ready indicators: softer green (`#6aa688`) instead of neon `#00ff00`
- Victory/defeat colors: muted, less aggressive
- Match found glow: bronze pulse instead of gold

---

## 2. Queue Player List (Full Transparency)

When waiting in queue, players see a live list of everyone currently searching.

### Queue Status Panel Layout

```
┌─────────────────────────────────────────────────┐
│  SEARCHING FOR 1v1 MATCH                        │
│  Your Position: #3 of 8 players                 │
├─────────────────────────────────────────────────┤
│  Players in Queue                           8   │
├─────────────────────────────────────────────────┤
│  #1  ShadowBlade      Gold    1485 ELO   Lv.32  │
│      ○ Waiting 2m 15s                           │
│  #2  DragonSlayer     Gold    1462 ELO   Lv.29  │
│      ○ Waiting 1m 40s                           │
│  #3  YOU              Silver  1380 ELO   Lv.24  │
│      ○ Waiting 45s                      [YOU]   │
│  #4  Healer4Life      Silver  1350 ELO   Lv.26  │
│      ○ Waiting 30s                              │
│  ...                                            │
├─────────────────────────────────────────────────┤
│  Estimated Wait: ~30 seconds                    │
│                                                 │
│         [ Leave Queue ]                         │
└─────────────────────────────────────────────────┘
```

### Data Shown Per Player
- **Position** in queue (#1, #2, etc.)
- **Username**
- **Tier badge** (Bronze/Silver/Gold/Platinum/Master/Grandmaster)
- **ELO rating**
- **Party level** (average level of battle party)
- **Wait time** (how long they've been queuing)

### Styling
- Current user row: steel-blue left border + "YOU" badge
- Scrollable list with max-height
- Real-time updates via WebSocket

### Backend Requirements
New endpoint: `GET /api/coliseum/queue/:queueType/players`

```json
{
  "success": true,
  "players": [
    {
      "oduscatedId": "abc123",
      "username": "ShadowBlade",
      "rating": 1485,
      "tier": "gold",
      "partyLevel": 32,
      "waitTime": 135,
      "isCurrentUser": false
    }
  ]
}
```

WebSocket event: `coliseum:queue_players_update` - broadcast when players join/leave

---

## 3. Rank Tier System

### Tier Thresholds

| Tier | ELO Range | Color | Badge |
|------|-----------|-------|-------|
| Unranked | 0-999 | Gray `#6a6a6a` | — |
| Bronze | 1000-1199 | Bronze `#cd7f32` | Shield |
| Silver | 1200-1399 | Silver `#a8a8a8` | Crossed swords |
| Gold | 1400-1599 | Gold `#b8956a` | Crown |
| Platinum | 1600-1799 | Ice blue `#7ec8e8` | Diamond |
| Master | 1800-1999 | Purple `#9a6ab8` | Star |
| Grandmaster | 2000+ | Crimson `#c45a5a` | Trophy |

### Tier Display Locations
- Queue list: badge + tier name next to each player
- Leaderboard: tier badge in rank column
- Match found: opponent's tier prominently displayed
- Match history: tier at time of match on cards
- Profile: current tier with progress bar to next tier

### Tier Features
- **Demotion protection**: 3 losses grace period after promotion
- **Progress indicator**: "Silver - 180/200 to Gold" progress bar
- **Peak tier tracking**: database stores highest tier achieved

### Helper Function

```javascript
export function getTier(rating) {
  if (rating >= 2000) return { name: 'Grandmaster', color: '#c45a5a', icon: 'trophy' };
  if (rating >= 1800) return { name: 'Master', color: '#9a6ab8', icon: 'star' };
  if (rating >= 1600) return { name: 'Platinum', color: '#7ec8e8', icon: 'diamond' };
  if (rating >= 1400) return { name: 'Gold', color: '#b8956a', icon: 'crown' };
  if (rating >= 1200) return { name: 'Silver', color: '#a8a8a8', icon: 'swords' };
  if (rating >= 1000) return { name: 'Bronze', color: '#cd7f32', icon: 'shield' };
  return { name: 'Unranked', color: '#6a6a6a', icon: null };
}
```

---

## 4. Achievement Badges

### Milestone Badges (Permanent)

| Key | Name | Icon | Condition |
|-----|------|------|-----------|
| `first_blood` | First Blood | ⚔️ | Win your first PvP match |
| `veteran` | Veteran | 🎯 | Win 50 PvP matches |
| `legend` | Coliseum Legend | 🏛️ | Win 200 PvP matches |
| `climber` | Climber | 📈 | Reach Gold tier |
| `elite` | Elite | 👑 | Reach Master tier |
| `champion` | Champion | 🏆 | Reach Grandmaster tier |

### Skill Badges (Earned Through Feats)

| Key | Name | Icon | Condition |
|-----|------|------|-----------|
| `giant_slayer` | Giant Slayer | 💪 | Beat opponent 200+ ELO above you |
| `underdog` | Underdog | 🐣 | Win with 20%+ PPR disadvantage |
| `flawless` | Flawless | ✨ | Win without losing a single unit |
| `comeback` | Comeback Kid | 🔄 | Win after losing 50%+ of units first |

### Streak Badges (Dynamic)

| Key | Name | Icon | Condition |
|-----|------|------|-----------|
| `on_fire` | On Fire | 🔥 | Active 3+ win streak |
| `unstoppable` | Unstoppable | 💀 | Active 5+ win streak |
| `dominating` | Dominating | ⚡ | Active 10+ win streak |

### Badge Display Rules
- **Leaderboard**: Up to 3 badges next to player name
- **Queue list**: Current streak badge only (if active)
- **Match found**: Opponent's top 3 badges
- **Profile**: Full badge collection with unlock dates

### Badge Priority (for display limits)
1. Streak badges (current state)
2. Tier badges (champion > elite > climber)
3. Skill badges (by rarity)
4. Milestone badges (by difficulty)

---

## 5. Enhanced Match Found Screen

### Layout

```
┌─────────────────────────────────────────────────┐
│              ⚔️ MATCH FOUND! ⚔️                 │
│         (bronze glow, subtle pulse)             │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  YOUR OPPONENT                          │   │
│  ├─────────────────────────────────────────┤   │
│  │                                         │   │
│  │  DragonSlayer                    Gold   │   │
│  │  1,485 ELO                        👑    │   │
│  │                                         │   │
│  │  ┌─────────┬─────────┬─────────┐       │   │
│  │  │ Win Rate│ Matches │ Streak  │       │   │
│  │  │  62.5%  │   48    │  🔥 3   │       │   │
│  │  └─────────┴─────────┴─────────┘       │   │
│  │                                         │   │
│  │  Party Level: 29   ⚔️ 💪 ✨            │   │
│  │  (achievement badges)                   │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌───────────────────────────────────────┐     │
│  │         [ READY ]  (large button)     │     │
│  └───────────────────────────────────────┘     │
│                                                 │
│     Ready Status:  ● You    ○ Opponent         │
│                                                 │
│     Time Remaining: 25s                         │
└─────────────────────────────────────────────────┘
```

### Opponent Card Data
- **Username**: prominently displayed
- **Tier badge**: visual icon + tier name
- **ELO rating**: exact number
- **Stats row**: Win rate %, total matches, current streak
- **Party level**: average battle party level
- **Achievement badges**: up to 3 earned badges

### Ready Indicator
- Filled circle (●) = ready (steel-blue `#4a6b8a`)
- Empty circle (○) = waiting (gray)
- Timer: bronze accent color, counts from 30

---

## 6. Implementation Plan

### Files to Modify

**Frontend:**
| File | Changes |
|------|---------|
| `frontend/src/scenes/coliseum/coliseumStyles.js` | New Slate Arena color palette |
| `frontend/src/scenes/coliseum/tabs/ColiseumQueueTab.js` | Queue player list with full transparency |
| `frontend/src/scenes/coliseum/tabs/ColiseumLeaderboardTab.js` | Tier badges, achievement display |
| `frontend/src/scenes/coliseum/tabs/ColiseumHistoryTab.js` | Tier badges on match cards |
| `frontend/src/scenes/ColiseumScene.js` | Match found screen enhancements |

**Backend:**
| File | Changes |
|------|---------|
| `api/src/services/coliseumService.js` | Tier calculations, badge logic, queue player list |
| `api/src/routes/coliseum.js` | New endpoints for queue players, badges |
| `api/src/migrations/XXX_pvp_achievements.sql` | New tables and columns |

### New API Endpoints

```
GET /api/coliseum/queue/:queueType/players
  - Returns list of players in specified queue
  - Includes: username, rating, tier, partyLevel, waitTime

GET /api/coliseum/achievements/:userId
  - Returns user's earned achievement badges
  - Includes: key, name, icon, earnedAt
```

### Database Schema Changes

```sql
-- Add tier tracking to pvp_ratings
ALTER TABLE pvp_ratings ADD COLUMN tier VARCHAR(32);
ALTER TABLE pvp_ratings ADD COLUMN peak_tier VARCHAR(32);
ALTER TABLE pvp_ratings ADD COLUMN tier_protection_losses INTEGER DEFAULT 0;

-- Achievement badges table
CREATE TABLE pvp_achievements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  achievement_key VARCHAR(64) NOT NULL,
  earned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, achievement_key)
);

CREATE INDEX idx_pvp_achievements_user ON pvp_achievements(user_id);
```

### WebSocket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `coliseum:queue_players_update` | Server → Client | Broadcast queue player list changes |
| `coliseum:achievement_earned` | Server → Client | Notify player of new badge |

---

## 7. Task Breakdown

### Phase 1: Color Scheme (Frontend)
1. Update `ARENA_COLORS` in coliseumStyles.js
2. Update all color references throughout Coliseum components
3. Test visual consistency across all tabs

### Phase 2: Tier System (Full Stack)
1. Add database columns for tier tracking
2. Create `getTier()` helper function (shared)
3. Update leaderboard to show tier badges
4. Update match history to show tiers
5. Add tier to queue status display

### Phase 3: Queue Transparency (Full Stack)
1. Create queue players endpoint
2. Add WebSocket broadcast for queue changes
3. Build queue player list UI component
4. Wire up real-time updates
5. Style current user highlighting

### Phase 4: Achievement Badges (Full Stack)
1. Create pvp_achievements table
2. Implement badge check logic in coliseumService
3. Create achievements endpoint
4. Add badge display to leaderboard
5. Add badge display to match found screen
6. Add badge display to queue list (streak only)

### Phase 5: Match Found Enhancements (Frontend)
1. Redesign opponent card layout
2. Add stats row (win rate, matches, streak)
3. Add badge display
4. Update ready indicator styling
5. Add bronze glow animation

---

## 8. Success Criteria

- [ ] All red colors replaced with slate-blue/bronze palette
- [ ] Queue shows full player list with names, ELO, tier, wait time
- [ ] Tier badges display correctly in all locations
- [ ] Achievement badges unlock and display properly
- [ ] Match found screen shows enhanced opponent info
- [ ] Real-time queue updates work via WebSocket
- [ ] No regression in existing Coliseum functionality
