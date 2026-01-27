/**
 * Item Templates
 *
 * All item definitions for the game.
 * Items are seeded in order - templateId corresponds to array index + 1.
 *
 * Categories:
 * - Weapons (templateId 1-6, 16-20, 33-44)
 * - Armor (templateId 7-9, 21-25, 34-43)
 * - Accessories (templateId 10-11, 26-28, 35-44)
 * - Consumables (templateId 12-15, 29-32)
 */

export const ITEM_TEMPLATES = [
  // Weapons (templateId 1-6)
  { name: 'Rusty Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 3 }, level_requirement: 1, base_price: 50, rarity: 1, description: 'A worn blade, but still sharp enough to cut.' },           // 1
  { name: 'Iron Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 7 }, level_requirement: 5, base_price: 150, rarity: 2, description: 'A sturdy iron blade forged by skilled smiths.' },            // 2
  { name: 'Steel Blade', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 12, agility: 3 }, level_requirement: 15, base_price: 400, rarity: 3, description: 'High-quality steel, perfectly balanced.' },   // 3
  { name: 'Oak Staff', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 5 }, level_requirement: 1, base_price: 60, rarity: 1, description: 'A simple staff carved from oak wood.' },                  // 4
  { name: 'Mystic Staff', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 10, mp_max: 20 }, level_requirement: 10, base_price: 300, rarity: 2, description: 'Imbued with magical essence.' },         // 5
  { name: 'Combat Gloves', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 4, agility: 3 }, level_requirement: 1, base_price: 45, rarity: 1, description: 'Reinforced gloves for martial artists.' },     // 6

  // Armor (templateId 7-9)
  { name: 'Leather Armor', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 3, hp_max: 15 }, level_requirement: 1, base_price: 80, rarity: 1, description: 'Light armor that allows free movement.' },           // 7
  { name: 'Chain Mail', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 6, hp_max: 30 }, level_requirement: 8, base_price: 250, rarity: 2, description: 'Interlocking rings provide solid protection.' },       // 8
  { name: 'Cloth Robe', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { intelligence: 3, mp_max: 15 }, level_requirement: 1, base_price: 70, rarity: 1, description: 'A robe favored by spellcasters.' },                 // 9

  // Accessories (templateId 10-11)
  { name: 'Lucky Charm', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { luck: 5 }, level_requirement: 1, base_price: 100, rarity: 2, description: 'A four-leaf clover preserved in crystal.' },                 // 10
  { name: 'Ring of Vitality', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { hp_max: 25, vitality: 3 }, level_requirement: 5, base_price: 200, rarity: 2, description: 'Pulses with life energy.' },            // 11

  // Consumables (templateId 12-15)
  { name: 'Health Potion', item_type: 'consumable', effect_type: 'heal_hp', effect_value: 50, base_price: 25, rarity: 1, sprite_id: 'potion_health', description: 'Restores 50 HP when consumed.' },                                   // 12
  { name: 'Mana Potion', item_type: 'consumable', effect_type: 'heal_mp', effect_value: 30, base_price: 30, rarity: 1, sprite_id: 'potion_mana', description: 'Restores 30 MP when consumed.' },                                      // 13
  { name: 'Antidote', item_type: 'consumable', effect_type: 'cure_poison', effect_value: 0, base_price: 15, rarity: 1, sprite_id: 'antidote', description: 'Cures poison status.' },                                                   // 14
  { name: 'Phoenix Feather', item_type: 'consumable', effect_type: 'revive', effect_value: 50, base_price: 500, rarity: 4, sprite_id: 'phoenix_feather', description: 'Revives a fallen ally with 50% HP.' },                          // 15

  // Additional Weapons (templateId 16-20)
  { name: 'Bronze Axe', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 5 }, level_requirement: 3, base_price: 90, rarity: 1, description: 'A heavy axe with a bronze head.' },                          // 16
  { name: 'Iron Axe', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 9, vitality: 2 }, level_requirement: 8, base_price: 220, rarity: 2, description: 'A brutish weapon favored by warriors.' },         // 17
  { name: 'Apprentice Wand', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 3, mp_max: 10 }, level_requirement: 1, base_price: 40, rarity: 1, description: 'A basic wand for magic students.' },     // 18
  { name: 'Steel Fist', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 7, agility: 5 }, level_requirement: 10, base_price: 180, rarity: 2, description: 'Metal knuckles for devastating punches.' },     // 19
  { name: 'Throwing Knives', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { agility: 6, luck: 3 }, level_requirement: 5, base_price: 120, rarity: 2, description: 'A set of balanced throwing blades.' },          // 20

  // Additional Armor (templateId 21-25)
  { name: 'Leather Helm', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { vitality: 2 }, level_requirement: 1, base_price: 40, rarity: 1, description: 'A simple leather cap.' },                                         // 21
  { name: 'Iron Helm', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { vitality: 4, strength: 1 }, level_requirement: 8, base_price: 120, rarity: 2, description: 'Solid iron protection for the head.' },                // 22
  { name: 'Leather Boots', item_type: 'armor', equipment_slot: 'feet', stat_bonuses: { agility: 2 }, level_requirement: 1, base_price: 35, rarity: 1, description: 'Comfortable boots for travel.' },                                 // 23
  { name: 'Iron Greaves', item_type: 'armor', equipment_slot: 'feet', stat_bonuses: { vitality: 3, agility: 1 }, level_requirement: 8, base_price: 100, rarity: 2, description: 'Heavy leg armor.' },                                 // 24
  { name: 'Wizard Hat', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { intelligence: 4, mp_max: 10 }, level_requirement: 5, base_price: 90, rarity: 2, description: 'A pointy hat imbued with magic.' },                 // 25

  // Additional Accessories (templateId 26-28)
  { name: 'Iron Ring', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { strength: 2, vitality: 1 }, level_requirement: 1, base_price: 50, rarity: 1, description: 'A simple iron band.' },                        // 26
  { name: 'Mage Ring', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { intelligence: 4, mp_max: 15 }, level_requirement: 5, base_price: 150, rarity: 2, description: 'Enhances magical power.' },                // 27
  { name: 'Speed Amulet', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { agility: 5 }, level_requirement: 3, base_price: 130, rarity: 2, description: 'Increases reflexes and speed.' },                        // 28

  // Additional Consumables (templateId 29-32)
  { name: 'Hi-Potion', item_type: 'consumable', effect_type: 'heal_hp', effect_value: 150, base_price: 100, rarity: 2, sprite_id: 'potion_health_large', description: 'Restores 150 HP when consumed.' },                              // 29
  { name: 'Hi-Ether', item_type: 'consumable', effect_type: 'heal_mp', effect_value: 80, base_price: 120, rarity: 2, sprite_id: 'potion_mana_large', description: 'Restores 80 MP when consumed.' },                                  // 30
  { name: 'Elixir', item_type: 'consumable', effect_type: 'heal_both', effect_value: 100, base_price: 300, rarity: 3, sprite_id: 'elixir_life', description: 'Restores 100 HP and 50 MP.' },                                          // 31
  { name: 'Status Cure', item_type: 'consumable', effect_type: 'cure_all', effect_value: 0, base_price: 75, rarity: 2, sprite_id: 'status_cure', description: 'Cures all negative status effects.' },                                  // 32

  // Guild Starter Equipment (base_price = 2 for 1 gold sell value)
  // Warrior Guild
  { name: 'Trainee Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A simple blade given to warrior initiates.' },                   // 33
  { name: 'Trainee Tunic', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Padded cloth worn during basic training.' },                            // 34
  { name: 'Warrior\'s Pendant', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { hp_max: 5 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A token of the warrior guild.' },                            // 35

  // Wizard Guild
  { name: 'Novice Wand', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A basic focus for channeling magic.' },                         // 36
  { name: 'Student Robe', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { mp_max: 5 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Standard robes for magic students.' },                                     // 37
  { name: 'Mage\'s Crystal', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { intelligence: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A small crystal attuned to mana.' },                      // 38

  // Monk Guild
  { name: 'Initiate Wraps', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { agility: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Cloth wraps for hand-to-hand combat.' },                          // 39
  { name: 'Initiate Gi', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { agility: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Light garments for martial training.' },                                   // 40
  { name: 'Monk\'s Beads', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { luck: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Prayer beads blessed by the monastery.' },                          // 41

  // Chemist Guild
  { name: 'Mixing Rod', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A tool for stirring potions and reagents.' },                    // 42
  { name: 'Alchemist Coat', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { hp_max: 3, mp_max: 3 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Protective garment with many pockets.' },                     // 43
  { name: 'Reagent Pouch', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { luck: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A small bag of basic alchemical supplies.' }                       // 44
];

/**
 * Shop inventory stock by shop type
 */
export const SHOP_STOCK = {
  blacksmith: {
    // Weapons and armor
    items: [
      { templateId: 1, qty: 10 },  // Rusty Sword
      { templateId: 4, qty: 8 },   // Oak Staff
      { templateId: 6, qty: 8 },   // Combat Gloves
      { templateId: 7, qty: 10 },  // Leather Armor
      { templateId: 9, qty: 8 },   // Cloth Robe
      { templateId: 16, qty: 6 },  // Bronze Axe
      { templateId: 18, qty: 6 },  // Apprentice Wand
      { templateId: 21, qty: 10 }, // Leather Helm
      { templateId: 23, qty: 10 }, // Leather Boots
      // Higher level items (less stock)
      { templateId: 2, qty: 4 },   // Iron Sword
      { templateId: 8, qty: 4 },   // Chain Mail
      { templateId: 17, qty: 3 },  // Iron Axe
      { templateId: 19, qty: 3 },  // Steel Fist
      { templateId: 22, qty: 4 },  // Iron Helm
      { templateId: 24, qty: 4 },  // Iron Greaves
      { templateId: 25, qty: 3 },  // Wizard Hat
    ]
  },
  apothecary: {
    // Consumables
    items: [
      { templateId: 12, qty: 20 }, // Health Potion
      { templateId: 13, qty: 15 }, // Mana Potion
      { templateId: 14, qty: 10 }, // Antidote
      { templateId: 29, qty: 8 },  // Hi-Potion
      { templateId: 30, qty: 6 },  // Hi-Ether
      { templateId: 31, qty: 3 },  // Elixir
      { templateId: 32, qty: 5 },  // Status Cure
      { templateId: 15, qty: 2 },  // Phoenix Feather (rare)
    ]
  },
  farm: {
    // Basic consumables at lower prices (village economy)
    items: [
      { templateId: 12, qty: 15 }, // Health Potion
      { templateId: 13, qty: 10 }, // Mana Potion
      { templateId: 14, qty: 8 },  // Antidote
    ]
  }
};
