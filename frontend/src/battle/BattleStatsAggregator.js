/**
 * @module BattleStatsAggregator
 * @description Pure utility class for calculating per-unit battle statistics from log entries.
 * No DOM dependencies - suitable for unit testing.
 *
 * @see BattleLogModal.js - Log entry structure definition
 * @see api/src/services/coliseum/statistics.js - Backend equivalent
 */

/**
 * Aggregates battle statistics from log entries for each unit
 */
export class BattleStatsAggregator {
  /**
   * @param {Array} units - Array of unit objects with id, name, class, race, level, teamId, ownerId, hp
   * @param {Array} logEntries - Array of battle log entries
   */
  constructor(units, logEntries) {
    this.units = units || [];
    this.logEntries = logEntries || [];
  }

  /**
   * Calculate statistics for all units
   * @returns {Array} Array of unit stats objects
   */
  calculate() {
    // Initialize stats map from units
    const statsMap = new Map();

    for (const unit of this.units) {
      statsMap.set(unit.id, {
        id: unit.id,
        name: unit.name ?? 'Unknown',
        class: unit.class ?? null,
        race: unit.race ?? null,
        level: unit.level ?? 1,
        teamId: unit.teamId ?? null,
        ownerId: unit.ownerId ?? null,
        damageDealt: 0,
        damageTaken: 0,
        healingDone: 0,
        kills: 0,
        deaths: (unit.hp ?? 0) <= 0 ? 1 : 0
      });
    }

    // Process log entries
    for (const entry of this.logEntries) {
      this.processEntry(entry, statsMap);
    }

    return Array.from(statsMap.values());
  }

  /**
   * Process a single log entry and update stats
   * @param {Object} entry - Log entry
   * @param {Map} statsMap - Map of unit ID to stats
   */
  processEntry(entry, statsMap) {
    if (!entry) return;

    // Extract actor and target IDs
    // Frontend log format: { actor: { id }, target: { id }, result: { damage, healing, targetDefeated } }
    // Backend log format: { actorId, targetId, result: { damage, healing, targetDefeated } }
    const actorId = entry.actor?.id ?? entry.actorId;
    const targetId = entry.target?.id ?? entry.result?.targetId ?? entry.targetId;

    // Extract result values (handle both nested and flat formats)
    const damage = entry.result?.damage ?? entry.damage ?? 0;
    const healing = entry.result?.healing ?? entry.healing ?? 0;
    const targetDefeated = entry.result?.targetDefeated ?? entry.targetDefeated ?? false;

    // Update damage dealt by actor
    if (damage > 0 && actorId != null) {
      const actorStats = statsMap.get(actorId);
      if (actorStats) {
        actorStats.damageDealt += damage;
      }
    }

    // Update damage taken by target
    if (damage > 0 && targetId != null) {
      const targetStats = statsMap.get(targetId);
      if (targetStats) {
        targetStats.damageTaken += damage;
      }
    }

    // Update healing done by actor
    if (healing > 0 && actorId != null) {
      const actorStats = statsMap.get(actorId);
      if (actorStats) {
        actorStats.healingDone += healing;
      }
    }

    // Update kills for actor
    if (targetDefeated && actorId != null) {
      const actorStats = statsMap.get(actorId);
      if (actorStats) {
        actorStats.kills += 1;
      }
    }
  }

  /**
   * Get the MVP (Most Valuable Player) for a specific team
   * MVP criteria (in order):
   * 1. Most damage dealt (primary)
   * 2. Most kills (secondary tiebreaker)
   * 3. Fewest deaths (tertiary tiebreaker)
   *
   * @param {number|string} teamId - The team ID to find MVP for
   * @returns {Object|null} The MVP unit stats or null if no units on team
   */
  getMVP(teamId) {
    const stats = this.calculate();
    const teamStats = stats.filter(s => s.teamId === teamId);

    if (teamStats.length === 0) {
      return null;
    }

    // Sort by MVP criteria
    teamStats.sort((a, b) => {
      // Primary: Most damage dealt
      if (b.damageDealt !== a.damageDealt) {
        return b.damageDealt - a.damageDealt;
      }
      // Secondary: Most kills
      if (b.kills !== a.kills) {
        return b.kills - a.kills;
      }
      // Tertiary: Fewest deaths
      return a.deaths - b.deaths;
    });

    return teamStats[0];
  }
}
