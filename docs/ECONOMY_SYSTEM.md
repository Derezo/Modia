# Economy System

| Document | Version | Last Updated |
|----------|---------|--------------|
| Economy System Specification | 2.0 | 2026-01-06 |

## Table of Contents

1. [Overview](#1-overview)
2. [NPC Shop System](#2-npc-shop-system)
   - 2.1 Shop Types and Locations
   - 2.2 NPC Buying (Player Sells)
   - 2.3 NPC Selling (Dynamic Pricing)
   - 2.4 NPC Inventory Management
   - 2.5 Shop Item Restrictions
   - 2.6 Base Stock Generation
3. [Player Marketplace](#3-player-marketplace)
   - 3.1 Overview
   - 3.2 Order Book Structure
   - 3.3 Limit Orders
   - 3.4 Market Orders
   - 3.5 Order Matching Algorithm
   - 3.6 Partial Fill Examples
   - 3.7 Marketplace Restrictions
   - 3.8 Gold Reservation System
4. [Price Discovery](#4-price-discovery)
5. [Database Schema](#5-database-schema)
6. [API Endpoints](#6-api-endpoints)
7. [Economic Balance](#7-economic-balance)

---

## 1. Overview

Modia's economy consists of two primary trading systems:

1. **NPC Shops** - Fixed locations where players buy/sell items with NPCs
2. **Player Marketplace** - Open market where players trade directly with each other

### 1.1 Economic Philosophy

- Gold flows from PvE battles into player hands
- NPC shops act as gold sinks (50% buyback rate)
- Player marketplace transfers gold between players (zero-sum)
- Dynamic NPC pricing prevents exploitation

### 1.2 Currency

**Gold** is the sole currency, earned through:
- Battle victories (30-250g based on difficulty)
- Selling items to NPCs (50% of base value)
- Selling items to players via marketplace

### 1.3 Gold Flow Diagram

```
                    ┌─────────────┐
                    │   BATTLES   │
                    │  (PvE/PvP)  │
                    └──────┬──────┘
                           │ Gold enters economy
                           ▼
┌──────────────────────────────────────────────────────┐
│                   PLAYER GOLD                         │
└───────┬──────────────────┬──────────────────┬────────┘
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌────────────────┐
│  NPC SHOPS    │  │  MARKETPLACE  │  │ GUILD RECRUITS │
│ (Gold Sink)   │  │ (Gold Neutral)│  │  (Gold Sink)   │
│               │  │               │  │                │
│ Buy at 50%    │  │ Player ↔ Player│  │ 2,000-12,000g │
│ Sell at 60-120%│ │ No fees       │  │  per recruit   │
└───────────────┘  └───────────────┘  └────────────────┘
```

---

## 2. NPC Shop System

NPC shops provide a reliable way to buy and sell items at fixed locations throughout the world.

### 2.1 Shop Types and Locations

| Shop Type | Locations | Primary Function |
|-----------|-----------|------------------|
| Blacksmith | Castle, City | Weapons, Armor, Shields, Metal Equipment |
| Apothecary | Castle, City, Village | Potions, Consumables, Ingredients |
| Farm | Village | Food items (HP restoration outside battle) |

#### Shop Availability by Node Type

| Node Type | Blacksmith | Apothecary | Farm | Marketplace |
|-----------|------------|------------|------|-------------|
| Castle | Yes | Yes | No | Yes |
| City | Yes | Yes | No | No |
| Village | No | 50% chance | Yes | No |

### 2.2 NPC Buying (Player Sells to NPC)

When players sell items to NPCs:

**Base Formula:**
```
sell_price = floor(item_base_value × 0.50)
```

**Rules:**
- Items must match shop specialty (see Section 2.5)
- Sold items enter NPC inventory for resale to other players
- Transaction is immediate (gold added to player balance)
- No quantity limits

**Example:**
- Player sells "Steel Sword" (base value: 500g)
- Blacksmith pays: 500 × 0.50 = 250g
- Steel Sword enters Blacksmith's inventory

### 2.3 NPC Selling (Dynamic Supply-Based Pricing)

NPC sell prices fluctuate based on inventory levels, creating natural market dynamics.

#### Supply-Based Price Modifiers

| Supply Level | Quantity | Price Modifier | Description |
|--------------|----------|----------------|-------------|
| Scarce | 0-2 | 120% | High demand, limited stock |
| Low | 3-5 | 100% | Normal baseline pricing |
| Medium | 6-10 | 85% | Slight discount available |
| High | 11-20 | 70% | Bulk discount |
| Surplus | 21+ | 60% | Fire sale, overstocked |

#### Price Calculation

```
final_price = floor(item_base_value × supply_modifier)
```

**Example - Dynamic Pricing:**

The Blacksmith has 15 Iron Swords in stock (High supply):
- Base value: 100g
- Supply modifier: 70%
- Sell price: 100 × 0.70 = 70g

After players buy 12 swords, only 3 remain (Low supply):
- Supply modifier: 100%
- Sell price: 100 × 1.00 = 100g

#### Price Display

```
┌─────────────────────────────────────────┐
│         BLACKSMITH INVENTORY            │
├─────────────────────────────────────────┤
│ Item              Stock   Price  Trend  │
│ ───────────────── ─────── ────── ────── │
│ Iron Sword          3     100g    ─     │
│ Steel Sword        18      350g   ▼     │
│ Mythril Blade       1     1,440g  ▲     │
│ Iron Shield        12      140g   ▼     │
│ Plate Armor         5      500g   ─     │
└─────────────────────────────────────────┘
  ▲ = Scarce (120%)  ─ = Normal  ▼ = Surplus
```

### 2.4 NPC Inventory Management

#### Base Stock

Each shop generates a baseline inventory that refreshes periodically:

| Shop Type | Base Stock Refresh | Max Base Items |
|-----------|-------------------|----------------|
| Blacksmith | Every 24 hours | 50 item types |
| Apothecary | Every 12 hours | 30 item types |
| Farm | Every 6 hours | 10 item types |

Base stock items scale with node distance from Castle:
- Castle shops: All tiers available
- Cities: Up to mid-tier materials
- Villages: Basic materials only

#### Player-Sold Items

Items sold by players to NPCs:
- Marked internally as `is_player_sold = true`
- Subject to same dynamic pricing
- Decay over time if not purchased (7 days)
- Display as "Pre-owned" in UI (optional)

#### Stock Decay

To prevent infinite accumulation:
```
daily_decay_rate = 0.10  // 10% of surplus items removed daily

if quantity > 20:
    decay_amount = floor((quantity - 20) × daily_decay_rate)
    quantity -= decay_amount
```

### 2.5 Shop Item Restrictions

#### Blacksmith Accepts/Sells

| Category | Item Types |
|----------|------------|
| Weapons (Metal) | Swords, Axes, Maces, Hammers, Daggers, Polearms |
| Armor (Metal) | Plate, Chainmail, Scale Mail, Brigandine |
| Shields | All types (Buckler, Round, Kite, Tower, Pavise) |
| Helmets (Metal) | Iron Helm, Great Helm, Chain Coif |
| Boots (Metal) | Iron Greaves, War Boots |

**Does NOT accept:** Cloth armor, robes, staves, wands, consumables, accessories

#### Apothecary Accepts/Sells

| Category | Item Types |
|----------|------------|
| Potions | HP Potions, MP Potions, Elixirs |
| Curatives | Antidotes, Status Cure items |
| Revival | Phoenix Down, Revival items |
| Ingredients | Herbs, Crafting materials |
| Consumables | Buff items, Temporary boosts |

**Does NOT accept:** Equipment, weapons, armor, accessories

#### Farm Accepts/Sells

| Category | Item Types |
|----------|------------|
| Food | Bread, Meat, Vegetables, Meals |
| Basic Ingredients | Wheat, Salt, Common herbs |

### 2.6 Base Stock Generation

Base stock is generated using the world seed for consistency:

```
generateBaseStock(shopType, nodeId, worldSeed):
    rng = SeededRandom(hashCombine(worldSeed, nodeId, shopType))

    itemPool = getItemPoolForShop(shopType)
    stockList = []

    for template in itemPool:
        if shouldIncludeItem(template, nodeDistance, rng):
            quantity = rollBaseQuantity(template.rarity, rng)
            stockList.push({
                templateId: template.id,
                quantity: quantity,
                isPlayerSold: false,
                priceModifier: 1.0
            })

    return stockList

rollBaseQuantity(rarity, rng):
    baseRanges = {
        "common": [5, 15],
        "uncommon": [3, 8],
        "rare": [1, 3],
        "epic": [0, 1],
        "legendary": [0, 0]  // Never in base stock
    }
    range = baseRanges[rarity]
    return range.min + floor(rng.next() × (range.max - range.min + 1))
```

---

## 3. Player Marketplace

The Player Marketplace is an open exchange system located exclusively at Castle nodes. It operates similarly to a stock exchange with order books, limit orders, and market orders.

### 3.1 Overview

| Feature | Description |
|---------|-------------|
| Location | Castle nodes only |
| Order Types | Limit Orders, Market Orders |
| Fees | None (no listing or transaction fees) |
| Max Orders | 10 open orders per player (buy + sell combined) |
| Item Restrictions | No Key Items |

### 3.2 Order Book Structure

Each tradeable item has its own order book with two sides:

- **Buy Orders (Bids)**: Players wanting to buy, sorted by price (highest first)
- **Sell Orders (Asks)**: Players wanting to sell, sorted by price (lowest first)

```
═══════════════════════════════════════════════════════════════
                    ORDER BOOK: Iron Sword
═══════════════════════════════════════════════════════════════

        BUY ORDERS (Bids)          │      SELL ORDERS (Asks)
   ────────────────────────────────│────────────────────────────
   Qty   Price    Player           │   Price    Qty    Player
   ────────────────────────────────│────────────────────────────
    5     95g     Alice            │    100g     3     Dave
   10     90g     Bob              │    105g     7     Eve
    3     85g     Carol            │    110g     2     Frank
    8     80g     Dan              │    115g    10     Grace
   ────────────────────────────────│────────────────────────────
                                   │
   Spread: 5g (95g bid / 100g ask) │
   Last Trade: 97g (2 hrs ago)     │
═══════════════════════════════════════════════════════════════
```

**Spread**: The difference between the highest buy order and lowest sell order. A narrow spread indicates an active market.

### 3.3 Limit Orders

Limit orders specify a maximum (buy) or minimum (sell) price and remain open until filled or cancelled.

#### Placing a Limit Buy Order

1. Player specifies: Item, Quantity, Maximum Price
2. System checks for matching sell orders at or below the limit price
3. If matches exist: execute trades immediately, best price first
4. Remaining unfilled quantity becomes an open buy order

```
placeLimitBuyOrder(playerId, itemId, quantity, maxPrice):
    // Validate player has enough gold
    totalRequired = quantity × maxPrice
    if player.gold < totalRequired:
        return ERROR("Insufficient gold")

    // Reserve the gold
    reserveGold(playerId, totalRequired)

    // Check for matching sell orders
    matchingSells = getSellOrders(itemId)
        .filter(o => o.price <= maxPrice)
        .sortByPriceAscending()

    filled = 0
    for order in matchingSells:
        if filled >= quantity:
            break

        fillQty = min(order.remainingQty, quantity - filled)
        executeTrade(buyer: playerId, seller: order.playerId,
                     item: itemId, qty: fillQty, price: order.price)
        filled += fillQty

    // Create open order for unfilled portion
    if filled < quantity:
        createOpenOrder(playerId, itemId, "buy",
                        quantity - filled, maxPrice)

    // Release excess reserved gold
    actualSpent = calculateActualSpent()
    releaseExcessReservation(playerId, totalRequired - actualSpent)
```

#### Placing a Limit Sell Order

1. Player specifies: Item, Quantity, Minimum Price
2. Items are transferred from inventory to escrow
3. System checks for matching buy orders at or above the limit price
4. If matches exist: execute trades immediately, best price first
5. Remaining unfilled quantity becomes an open sell order

```
placeLimitSellOrder(playerId, itemId, quantity, minPrice):
    // Validate player has items
    if player.inventory[itemId] < quantity:
        return ERROR("Insufficient items")

    // Move items to escrow
    escrowItems(playerId, itemId, quantity)

    // Check for matching buy orders
    matchingBuys = getBuyOrders(itemId)
        .filter(o => o.price >= minPrice)
        .sortByPriceDescending()

    filled = 0
    for order in matchingBuys:
        if filled >= quantity:
            break

        fillQty = min(order.remainingQty, quantity - filled)
        executeTrade(buyer: order.playerId, seller: playerId,
                     item: itemId, qty: fillQty, price: order.price)
        filled += fillQty

    // Create open order for unfilled portion
    if filled < quantity:
        createOpenOrder(playerId, itemId, "sell",
                        quantity - filled, minPrice)
```

#### Limit Order Properties

| Property | Description |
|----------|-------------|
| Persistence | Remains open until filled or cancelled |
| Partial Fills | Allowed; order stays open for remaining qty |
| Expiration | None (infinite until cancelled) |
| Price Improvement | May execute at better price than limit |

### 3.4 Market Orders

Market orders execute immediately at the best available prices. They do not create open orders - any unfilled portion simply fails.

#### Market Buy Order

```
executeMarketBuyOrder(playerId, itemId, quantity):
    // Get all sell orders sorted by price (lowest first)
    sellOrders = getSellOrders(itemId).sortByPriceAscending()

    filled = 0
    totalCost = 0
    trades = []

    for order in sellOrders:
        if filled >= quantity:
            break

        fillQty = min(order.remainingQty, quantity - filled)
        fillCost = fillQty × order.price

        // Check buyer can afford this portion
        if player.gold < totalCost + fillCost:
            break  // Stop here, can't afford more

        // Execute this trade
        trades.push({
            seller: order.playerId,
            quantity: fillQty,
            price: order.price
        })

        filled += fillQty
        totalCost += fillCost

        // Update or remove the sell order
        order.remainingQty -= fillQty
        if order.remainingQty == 0:
            removeOrder(order.id)

    // Process all trades
    for trade in trades:
        transferItems(trade.seller, playerId, itemId, trade.quantity)
        transferGold(playerId, trade.seller, trade.quantity × trade.price)

    return {
        success: filled > 0,
        filled: filled,
        unfilled: quantity - filled,
        totalCost: totalCost,
        averagePrice: filled > 0 ? totalCost / filled : 0
    }
```

#### Market Sell Order

```
executeMarketSellOrder(playerId, itemId, quantity):
    // Validate player has items
    if player.inventory[itemId] < quantity:
        return ERROR("Insufficient items")

    // Get all buy orders sorted by price (highest first)
    buyOrders = getBuyOrders(itemId).sortByPriceDescending()

    filled = 0
    totalRevenue = 0
    trades = []

    for order in buyOrders:
        if filled >= quantity:
            break

        fillQty = min(order.remainingQty, quantity - filled)
        fillRevenue = fillQty × order.price

        trades.push({
            buyer: order.playerId,
            quantity: fillQty,
            price: order.price
        })

        filled += fillQty
        totalRevenue += fillRevenue

        // Update or remove the buy order
        order.remainingQty -= fillQty
        if order.remainingQty == 0:
            removeOrder(order.id)
            releaseGoldReservation(order.playerId, order.id)

    // Process all trades
    for trade in trades:
        transferItems(playerId, trade.buyer, itemId, trade.quantity)
        transferGold(trade.buyer, playerId, trade.quantity × trade.price)

    return {
        success: filled > 0,
        filled: filled,
        unfilled: quantity - filled,
        totalRevenue: totalRevenue,
        averagePrice: filled > 0 ? totalRevenue / filled : 0
    }
```

#### Market Order Properties

| Property | Description |
|----------|-------------|
| Execution | Immediate against existing orders |
| Price | Best available (no limit specified) |
| Partial Fills | Yes, fills as much as possible |
| Unfilled Portion | Not created as order; simply not filled |
| Gold Check | Validates affordability during execution |

### 3.5 Order Matching Algorithm

The matching engine uses price-time priority:

1. **Price Priority**: Better prices match first
2. **Time Priority**: Among same-price orders, older orders match first

```
matchOrders(incomingOrder):
    if incomingOrder.type == "buy":
        oppositeOrders = getSellOrders(incomingOrder.itemId)
            .filter(o => o.price <= incomingOrder.price)
            .sortBy(o => [o.price, o.createdAt])  // Price asc, then time asc
    else:
        oppositeOrders = getBuyOrders(incomingOrder.itemId)
            .filter(o => o.price >= incomingOrder.price)
            .sortBy(o => [-o.price, o.createdAt])  // Price desc, then time asc

    for matchOrder in oppositeOrders:
        if incomingOrder.remainingQty == 0:
            break

        fillQty = min(incomingOrder.remainingQty, matchOrder.remainingQty)
        tradePrice = matchOrder.price  // Existing order's price

        executeTrade(incomingOrder, matchOrder, fillQty, tradePrice)

        incomingOrder.remainingQty -= fillQty
        matchOrder.remainingQty -= fillQty
```

**Trade Price Rule**: When orders match, the trade executes at the **existing order's price** (the order that was already in the book), giving price improvement to the incoming order.

### 3.6 Partial Fill Examples

#### Example 1: Market Buy with Multiple Sellers

**Scenario**: Player wants to buy 100 HP Potions via market order

**Current Sell Orders:**
| Order ID | Qty | Price | Seller |
|----------|-----|-------|--------|
| S1 | 30 | 10g | Alice |
| S2 | 25 | 12g | Bob |
| S3 | 20 | 15g | Carol |
| S4 | 50 | 18g | Dan |

**Execution Flow:**
```
Step 1: Fill 30 from S1 at 10g → Cost: 300g
Step 2: Fill 25 from S2 at 12g → Cost: 300g
Step 3: Fill 20 from S3 at 15g → Cost: 300g
Step 4: Fill 25 from S4 at 18g → Cost: 450g (only need 25 more)

Total: 100 potions for 1,350g (avg: 13.5g each)
```

**Result:**
- Player receives: 100 HP Potions
- Player pays: 1,350g
- Orders S1, S2, S3 fully filled and removed
- Order S4 reduced from 50 to 25 remaining

#### Example 2: Market Buy with Insufficient Liquidity

**Scenario**: Player wants to buy 100 HP Potions, only 75 available

**Current Sell Orders:**
| Order ID | Qty | Price | Seller |
|----------|-----|-------|--------|
| S1 | 30 | 10g | Alice |
| S2 | 25 | 12g | Bob |
| S3 | 20 | 15g | Carol |

**Execution:**
```
Fill 30 from S1 at 10g → 300g
Fill 25 from S2 at 12g → 300g
Fill 20 from S3 at 15g → 300g
No more sell orders available!
```

**Result:**
```json
{
    "success": true,
    "filled": 75,
    "unfilled": 25,
    "totalCost": 900,
    "averagePrice": 12
}
```

Player receives 75 potions, 25 remain unfilled (no open order created).

#### Example 3: Limit Order with Immediate Partial Fill

**Scenario**: Player places limit buy for 50 Iron Swords at 95g max

**Current Sell Orders:**
| Order ID | Qty | Price | Seller |
|----------|-----|-------|--------|
| S1 | 20 | 90g | Alice |
| S2 | 10 | 95g | Bob |
| S3 | 30 | 100g | Carol |

**Execution:**
```
Fill 20 from S1 at 90g → 1,800g (better than limit!)
Fill 10 from S2 at 95g → 950g (at limit)
S3 is above limit (100g > 95g), cannot fill

Remaining 20 units → Create open buy order at 95g
```

**Result:**
- 30 swords purchased for 2,750g
- Open order created: Buy 20 Iron Swords at 95g
- Gold reserved: 20 × 95 = 1,900g

### 3.7 Marketplace Restrictions

| Restriction | Value | Reason |
|-------------|-------|--------|
| Key Items | Cannot list | Quest progression items |
| Min Quantity | 1 | Practical minimum |
| Max Open Orders | 10 per player (buy + sell combined) | Prevent spam |
| Min Price | 1g | No free listings |
| Max Price | 999,999,999g | Practical maximum |

#### Item Escrow

When placing a sell order:
- Items are moved from inventory to escrow
- Items cannot be used, equipped, or traded while in escrow
- Items return to inventory on order cancellation

#### Gold Reservation

When placing a buy order:
- Gold equal to (quantity × price) is reserved
- Reserved gold cannot be spent elsewhere
- Gold returns on order cancellation
- Excess gold released if filled at better price

### 3.8 Gold Reservation System

The reservation system ensures buy orders can always be fulfilled.

```
┌─────────────────────────────────────────────────────────────┐
│                    PLAYER GOLD BALANCE                       │
├─────────────────────────────────────────────────────────────┤
│  Total Gold:     10,000g                                     │
│  ├─ Available:    6,500g  (can spend/use)                   │
│  └─ Reserved:     3,500g  (locked for orders)               │
│                                                              │
│  Active Buy Orders:                                          │
│  ├─ 50x Iron Sword @ 50g    = 2,500g reserved               │
│  └─ 20x HP Potion @ 50g     = 1,000g reserved               │
└─────────────────────────────────────────────────────────────┘
```

#### Reservation Lifecycle

```
1. Order Placed     → Gold reserved
2. Order Partially  → Reserved reduced by fill amount
   Filled              (at actual price, not limit)
3. Order Cancelled  → Full remaining reservation released
4. Order Fully      → No action needed (already transferred)
   Filled
```

---

## 4. Price Discovery

### 4.1 Market Price Calculation

The "Market Price" displayed for each item is determined by:

| Metric | Calculation | Use |
|--------|-------------|-----|
| Last Trade | Price of most recent trade | Primary display |
| Bid | Highest buy order price | Current demand |
| Ask | Lowest sell order price | Current supply |
| Spread | Ask - Bid | Market liquidity indicator |

### 4.2 Price Statistics

Track per item:
- Last 100 trades
- 24-hour high/low
- 24-hour volume (quantity traded)
- 7-day average price

```
┌─────────────────────────────────────────────┐
│           IRON SWORD - Market Data          │
├─────────────────────────────────────────────┤
│  Last Trade:    97g                         │
│  24h High:      105g                        │
│  24h Low:       92g                         │
│  24h Volume:    234 units                   │
│  7d Avg:        98g                         │
│                                             │
│  Current:  Bid: 95g  │  Ask: 100g          │
│            Spread: 5g (5.0%)                │
└─────────────────────────────────────────────┘
```

### 4.3 NPC Base Price Reference

Items in the marketplace can reference NPC base values:
- `npc_base_value`: What NPCs would pay (50%)
- `npc_sell_value`: What NPCs would charge (100% base)

This helps players understand if marketplace prices are good deals.

---

## 5. Database Schema

### 5.1 NPC Shop Tables

```sql
-- NPC Shop Inventory
CREATE TABLE npc_shop_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_type VARCHAR(50) NOT NULL,       -- 'blacksmith', 'apothecary', 'farm'
    node_id VARCHAR(100) NOT NULL,        -- Node where shop is located
    item_template_id VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    is_player_sold BOOLEAN DEFAULT FALSE, -- Player-sold vs base stock
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(shop_type, node_id, item_template_id, is_player_sold)
);

-- Index for fast lookups
CREATE INDEX idx_shop_inventory_lookup
ON npc_shop_inventory(shop_type, node_id);

-- Track when base stock was last refreshed
CREATE TABLE npc_shop_refresh (
    shop_type VARCHAR(50) NOT NULL,
    node_id VARCHAR(100) NOT NULL,
    last_refresh TIMESTAMP NOT NULL,
    next_refresh TIMESTAMP NOT NULL,

    PRIMARY KEY(shop_type, node_id)
);
```

### 5.2 Marketplace Tables

```sql
-- Active and historical orders
CREATE TABLE market_orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id),
    item_template_id VARCHAR(100) NOT NULL,
    item_instance_id UUID,                -- For unique items (non-fungible)
    order_type VARCHAR(10) NOT NULL,      -- 'buy' or 'sell'
    original_quantity INTEGER NOT NULL,
    remaining_quantity INTEGER NOT NULL,
    price_per_unit INTEGER NOT NULL,      -- Gold per item
    status VARCHAR(20) NOT NULL DEFAULT 'open',  -- 'open', 'filled', 'partial', 'cancelled'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    CHECK (order_type IN ('buy', 'sell')),
    CHECK (status IN ('open', 'filled', 'partial', 'cancelled')),
    CHECK (remaining_quantity >= 0),
    CHECK (remaining_quantity <= original_quantity)
);

-- Indexes for order matching
CREATE INDEX idx_market_orders_buy ON market_orders(item_template_id, price_per_unit DESC, created_at)
WHERE order_type = 'buy' AND status = 'open';

CREATE INDEX idx_market_orders_sell ON market_orders(item_template_id, price_per_unit ASC, created_at)
WHERE order_type = 'sell' AND status = 'open';

CREATE INDEX idx_market_orders_player ON market_orders(player_id, status);

-- Trade history
CREATE TABLE market_trades (
    trade_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buy_order_id UUID REFERENCES market_orders(order_id),
    sell_order_id UUID REFERENCES market_orders(order_id),
    buyer_id UUID NOT NULL REFERENCES players(id),
    seller_id UUID NOT NULL REFERENCES players(id),
    item_template_id VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL,
    price_per_unit INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    executed_at TIMESTAMP DEFAULT NOW()
);

-- Index for price history lookups
CREATE INDEX idx_market_trades_item ON market_trades(item_template_id, executed_at DESC);

-- Gold reservations for buy orders
CREATE TABLE gold_reservations (
    reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id),
    order_id UUID NOT NULL REFERENCES market_orders(order_id),
    amount INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(order_id)
);

-- Item escrow for sell orders
CREATE TABLE item_escrow (
    escrow_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES players(id),
    order_id UUID NOT NULL REFERENCES market_orders(order_id),
    item_template_id VARCHAR(100) NOT NULL,
    item_instance_id UUID,
    quantity INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(order_id)
);

-- Price statistics cache
CREATE TABLE market_price_stats (
    item_template_id VARCHAR(100) PRIMARY KEY,
    last_trade_price INTEGER,
    last_trade_at TIMESTAMP,
    high_24h INTEGER,
    low_24h INTEGER,
    volume_24h INTEGER,
    avg_7d DECIMAL(10,2),
    bid_price INTEGER,          -- Highest buy order
    ask_price INTEGER,          -- Lowest sell order
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 5.3 Player Gold Table Extension

```sql
-- Extend player table or create separate gold table
ALTER TABLE players ADD COLUMN gold_available INTEGER DEFAULT 100;
ALTER TABLE players ADD COLUMN gold_reserved INTEGER DEFAULT 0;

-- Computed total gold
-- gold_total = gold_available + gold_reserved
```

---

## 6. API Endpoints

### 6.1 NPC Shop Endpoints

#### Get Shop Inventory

```
GET /api/shops/:nodeId/:shopType/inventory

Response:
{
    "shopType": "blacksmith",
    "nodeId": "castle_main",
    "inventory": [
        {
            "itemTemplateId": "weapon_sword_iron",
            "name": "Iron Sword",
            "quantity": 5,
            "basePrice": 100,
            "currentPrice": 100,
            "priceModifier": 1.0,
            "supplyLevel": "low",
            "isPlayerSold": false
        },
        ...
    ]
}
```

#### Buy from NPC

```
POST /api/shops/:nodeId/:shopType/buy
Body:
{
    "itemTemplateId": "weapon_sword_iron",
    "quantity": 2
}

Response:
{
    "success": true,
    "itemsPurchased": 2,
    "totalCost": 200,
    "newGoldBalance": 1800
}
```

#### Sell to NPC

```
POST /api/shops/:nodeId/:shopType/sell
Body:
{
    "itemTemplateId": "weapon_sword_iron",
    "quantity": 1
}

Response:
{
    "success": true,
    "itemsSold": 1,
    "goldReceived": 50,
    "newGoldBalance": 1850
}
```

### 6.2 Marketplace Endpoints

#### Get Order Book

```
GET /api/marketplace/orderbook/:itemTemplateId

Response:
{
    "itemTemplateId": "weapon_sword_iron",
    "bids": [
        { "price": 95, "quantity": 5, "orderCount": 2 },
        { "price": 90, "quantity": 10, "orderCount": 1 },
        ...
    ],
    "asks": [
        { "price": 100, "quantity": 3, "orderCount": 1 },
        { "price": 105, "quantity": 7, "orderCount": 2 },
        ...
    ],
    "lastTradePrice": 97,
    "spread": 5
}
```

#### Get Player's Orders

```
GET /api/marketplace/orders/mine

Response:
{
    "openOrders": [
        {
            "orderId": "uuid",
            "itemTemplateId": "weapon_sword_iron",
            "orderType": "buy",
            "originalQuantity": 10,
            "remainingQuantity": 7,
            "pricePerUnit": 95,
            "status": "partial",
            "createdAt": "2026-01-06T12:00:00Z"
        },
        ...
    ],
    "totalReservedGold": 665,
    "totalEscrowedItems": 5
}
```

#### Place Limit Order

```
POST /api/marketplace/orders/limit
Body:
{
    "itemTemplateId": "weapon_sword_iron",
    "orderType": "buy",  // or "sell"
    "quantity": 10,
    "pricePerUnit": 95
}

Response:
{
    "success": true,
    "orderId": "uuid",
    "immediatelyFilled": 3,
    "remainingQuantity": 7,
    "goldReserved": 665,  // For buy orders
    "itemsEscrowed": 0    // For sell orders
}
```

#### Place Market Order

```
POST /api/marketplace/orders/market
Body:
{
    "itemTemplateId": "potion_hp_small",
    "orderType": "buy",  // or "sell"
    "quantity": 100
}

Response:
{
    "success": true,
    "filled": 75,
    "unfilled": 25,
    "totalCost": 900,      // For buy orders
    "totalRevenue": 0,     // For sell orders
    "averagePrice": 12,
    "trades": [
        { "quantity": 30, "price": 10, "counterparty": "Alice" },
        { "quantity": 25, "price": 12, "counterparty": "Bob" },
        { "quantity": 20, "price": 15, "counterparty": "Carol" }
    ]
}
```

#### Cancel Order

```
DELETE /api/marketplace/orders/:orderId

Response:
{
    "success": true,
    "goldReleased": 665,    // For buy orders
    "itemsReturned": 0      // For sell orders
}
```

#### Get Price History

```
GET /api/marketplace/history/:itemTemplateId?period=24h

Response:
{
    "itemTemplateId": "weapon_sword_iron",
    "period": "24h",
    "trades": [
        { "price": 97, "quantity": 5, "timestamp": "..." },
        ...
    ],
    "stats": {
        "high": 105,
        "low": 92,
        "volume": 234,
        "average": 98.5
    }
}
```

---

## 7. Economic Balance

### 7.1 Gold Sources

| Source | Gold/Event | Frequency | Notes |
|--------|------------|-----------|-------|
| Starting Gold | 100g | Once | New account |
| PvE Tier 1 | 30-60g | Per battle | Forests, early caves |
| PvE Tier 2 | 60-100g | Per battle | Mid-level areas |
| PvE Tier 3 | 100-150g | Per battle | Mountains, deep caves |
| PvE Tier 4 | 150-250g | Per battle | Palace, boss areas |
| PvP Victory | 50-100g | Per win | Coliseum |

### 7.2 Gold Sinks

| Sink | Cost | Notes |
|------|------|-------|
| NPC Buy Rate | 50% loss | Player sells at 50%, buys at 60-120% |
| NPC Stock Purchases | 60-120% | Base stock is gold creation |
| Guild Recruitment | 2,000-12,000g | Major gold sink for party expansion |
| Stables (future) | Variable | Fast travel costs |
| Repair (future) | 10-20% value | Equipment durability |

#### Guild Recruitment Pricing

Guild recruitment is a significant gold sink. Price ranges:

| Recruit Type | Price Range | Factors |
|--------------|-------------|---------|
| Basic (1 trait, avg stats) | 1,700-2,300g | Stat variance only |
| Good (1 trait, +skills) | 2,500-4,000g | +skills, better stats |
| Premium (2 traits) | 8,000-10,000g | Extra trait adds 8,000g |
| Exceptional (2 traits, +skills, +15% stats) | 10,000-12,000g | Maximum quality |

See [GUILD_RECRUITMENT_SYSTEM.md](GUILD_RECRUITMENT_SYSTEM.md) for detailed pricing formula.

### 7.3 Gold Flow Analysis

**Inflation Pressures:**
- PvE battles create gold from nothing
- More players = more gold generation

**Deflation Pressures:**
- NPC buy/sell spread (50% → 60-120%)
- Dynamic NPC pricing discourages selling to players when surplus

**Marketplace Effect:**
- Zero-sum (gold transfers, not created/destroyed)
- But enables efficient pricing, reducing NPC usage

### 7.4 Balance Recommendations

1. **Monitor Total Gold Supply**: Track `SUM(gold_available + gold_reserved)` over time
2. **Adjust Battle Rewards**: If inflation detected, reduce drop rates
3. **Add Consumables**: Potions, buffs create ongoing demand
4. **Equipment Decay** (Future): Durability system as gold sink

---

## Related Documents

| Document | Description |
|----------|-------------|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Core game mechanics, node features |
| [ITEM_SYSTEM.md](ITEM_SYSTEM.md) | Item generation, materials, augments |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database design, API infrastructure |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Full API documentation |
| [GUILD_RECRUITMENT_SYSTEM.md](GUILD_RECRUITMENT_SYSTEM.md) | Guild recruitment and pricing |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-06 | Initial document |
| 2.0 | 2026-01-06 | Removed temple revival; updated max orders to 10 |
