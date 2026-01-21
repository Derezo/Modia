/**
 * QuestMarkerManager - Manages quest markers on the world map
 *
 * Fetches quest-relevant nodes from API and provides marker data
 * for rendering on the world map. Markers indicate nodes that have
 * active quest objectives (kill enemies, visit locations, etc.)
 *
 * Quest types:
 * - Daily quests: Copper colored markers (#b87333)
 * - Weekly quests: Gold colored markers (#ffd700)
 *
 * @see QuestProgressHUD.js - Companion HUD component for quest progress display
 */
export class QuestMarkerManager {
  /**
   * @param {Object} game - Game instance with API client
   */
  constructor(game) {
    this.game = game;

    /** @type {Map<number, Object>} nodeId -> marker data */
    this.markers = new Map();

    /** @type {Array<Object>} Raw quest data from API */
    this.quests = [];

    /** @type {number} Timestamp of last fetch */
    this.lastFetch = 0;

    /** @type {number} Minimum interval between fetches (ms) */
    this.fetchInterval = 30000; // 30 seconds

    /** @type {boolean} Whether a fetch is in progress */
    this.isFetching = false;

    /** @type {AbortController|null} For canceling in-flight requests */
    this.abortController = null;
  }

  /**
   * Refresh quest markers from the API
   * @param {number} characterId - Character ID to fetch markers for
   * @returns {Promise<void>}
   */
  async refresh(characterId) {
    if (!characterId) {
      console.warn('[QuestMarkerManager] No characterId provided');
      return;
    }

    // Throttle requests
    const now = Date.now();
    if (this.isFetching || (now - this.lastFetch < this.fetchInterval)) {
      return;
    }

    this.isFetching = true;
    this.abortController = new AbortController();

    try {
      const result = await this.game.api.get(`/quests/markers/${characterId}`);

      this.lastFetch = now;
      // API returns { markers: [{nodeId, quests: [...]}] }
      this.buildMarkerMapFromAPI(result.markers || []);
    } catch (err) {
      // Silently fail - quest markers are optional enhancement
      if (err.name !== 'AbortError') {
        console.warn('[QuestMarkerManager] Failed to fetch quest markers:', err.message);
      }
    } finally {
      this.isFetching = false;
      this.abortController = null;
    }
  }

  /**
   * Force refresh regardless of throttle (e.g., after completing a quest)
   * @param {number} characterId - Character ID to fetch markers for
   * @returns {Promise<void>}
   */
  async forceRefresh(characterId) {
    this.lastFetch = 0;
    await this.refresh(characterId);
  }

  /**
   * Build the marker map from API response
   * API returns: { markers: [{nodeId, quests: [{questId, questType, name, progress, nearComplete}]}] }
   * @param {Array} apiMarkers - Markers array from API
   * @private
   */
  buildMarkerMapFromAPI(apiMarkers) {
    this.markers.clear();
    const questMap = new Map(); // Dedupe quests for HUD

    for (const marker of apiMarkers) {
      const { nodeId, quests } = marker;
      if (!nodeId || !quests || quests.length === 0) continue;

      // Build marker data
      let hasDaily = false;
      let hasWeekly = false;
      let nearComplete = false;
      const markerQuests = [];

      for (const quest of quests) {
        const progressPercent = Math.round((quest.progress || 0) * 100);

        if (quest.questType === 'daily') hasDaily = true;
        if (quest.questType === 'weekly') hasWeekly = true;
        if (quest.nearComplete || progressPercent >= 80) nearComplete = true;

        markerQuests.push({
          questId: quest.questId,
          questType: quest.questType,
          questName: quest.name,
          progress: quest.progress || 0,
          progressPercent,
          nearComplete: quest.nearComplete || progressPercent >= 80
        });

        // Track unique quests for HUD
        if (!questMap.has(quest.questId)) {
          questMap.set(quest.questId, {
            id: quest.questId,
            name: quest.name,
            type: quest.questType,
            progress: quest.progress || 0,
            progressPercent,
            nearComplete: quest.nearComplete || progressPercent >= 80
          });
        }
      }

      this.markers.set(nodeId, {
        questCount: quests.length,
        hasDaily,
        hasWeekly,
        quests: markerQuests,
        nearComplete
      });
    }

    // Store deduplicated quests for HUD
    this.quests = Array.from(questMap.values());
  }

  /**
   * Get marker data for a specific node
   * @param {number} nodeId - Node ID to get marker for
   * @returns {Object|null} Marker data or null if no marker
   */
  getMarkerForNode(nodeId) {
    return this.markers.get(nodeId) || null;
  }

  /**
   * Check if a node has quest markers
   * @param {number} nodeId - Node ID to check
   * @returns {boolean}
   */
  hasMarker(nodeId) {
    return this.markers.has(nodeId);
  }

  /**
   * Get all active quests (for HUD display)
   * Returns quests extracted from the markers API response
   * @returns {Array<Object>} Array of quest objects with progress info
   */
  getActiveQuests() {
    // quests are already processed in buildMarkerMapFromAPI
    return this.quests.map(quest => ({
      id: quest.id,
      name: quest.name,
      type: quest.type,
      progressPercent: quest.progressPercent,
      nearComplete: quest.nearComplete
    }));
  }

  /**
   * Get marker color for a quest type
   * @param {string} questType - 'daily' or 'weekly'
   * @returns {string} Hex color code
   */
  static getMarkerColor(questType) {
    return questType === 'weekly' ? '#ffd700' : '#b87333';
  }

  /**
   * Get marker badge colors based on marker data
   * Priority: Weekly (gold) > Daily (copper)
   * @param {Object} marker - Marker data object
   * @returns {Array<string>} Array of colors to render (max 3)
   */
  static getBadgeColors(marker) {
    if (!marker) return [];

    const colors = [];

    // Add weekly markers first (higher priority)
    if (marker.hasWeekly) {
      colors.push('#ffd700'); // Gold
    }

    // Add daily markers
    if (marker.hasDaily) {
      colors.push('#b87333'); // Copper
    }

    return colors.slice(0, 3);
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.markers.clear();
    this.quests = [];
  }
}
