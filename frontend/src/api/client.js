export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.token = null;
    this.onUnauthorized = null;
  }

  setToken(token) {
    this.token = token;
  }

  setUnauthorizedHandler(handler) {
    this.onUnauthorized = handler;
  }

  async request(method, endpoint, data = null, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
      ...options.headers
    };

    const fetchOptions = {
      method,
      headers
    };

    if (data && method !== 'GET') {
      fetchOptions.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, fetchOptions);

      // Handle 401 Unauthorized
      if (response.status === 401) {
        if (this.onUnauthorized) {
          this.onUnauthorized();
        }
        throw new Error('Unauthorized');
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || 'Request failed');
      }

      return result;
    } catch (err) {
      if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
        throw new Error('Unable to connect to server');
      }
      throw err;
    }
  }

  // HTTP method shortcuts
  get(endpoint, options) {
    return this.request('GET', endpoint, null, options);
  }

  post(endpoint, data, options) {
    return this.request('POST', endpoint, data, options);
  }

  put(endpoint, data, options) {
    return this.request('PUT', endpoint, data, options);
  }

  delete(endpoint, options) {
    return this.request('DELETE', endpoint, null, options);
  }

  // Auth endpoints
  async register(username, email, password) {
    const result = await this.post('/auth/register', { username, email, password });
    this.token = result.accessToken;
    return result;
  }

  async login(username, password) {
    const result = await this.post('/auth/login', { username, password });
    this.token = result.accessToken;
    return result;
  }

  async refresh(refreshToken) {
    const result = await this.post('/auth/refresh', { refreshToken });
    this.token = result.accessToken;
    return result;
  }

  async logout(refreshToken) {
    await this.post('/auth/logout', { refreshToken });
    this.token = null;
  }

  // Character endpoints
  getCharacters() {
    return this.get('/characters');
  }

  getCharacter(id) {
    return this.get(`/characters/${id}`);
  }

  createCharacter(name, race, characterClass, gender = 'other') {
    return this.post('/characters', { name, race, characterClass, gender });
  }

  deleteCharacter(id) {
    return this.delete(`/characters/${id}`);
  }

  // Party endpoints
  getParty() {
    return this.get('/party');
  }

  updateParty(formation) {
    return this.put('/party', { formation });
  }

  setBattleParty(characterIds) {
    return this.put('/party/battle', { characterIds });
  }

  // World endpoints
  getWorldSeed() {
    return this.get('/world/seed');
  }

  getWorldNodes() {
    return this.get('/world/nodes');
  }

  getWorldObstacles() {
    return this.get('/world/obstacles');
  }

  getWorldRegions() {
    return this.get('/world/regions');
  }

  getWorldRegion(regionId) {
    return this.get(`/world/regions/${regionId}`);
  }

  getNode(id) {
    return this.get(`/world/nodes/${id}`);
  }

  travel(targetNodeId) {
    return this.post('/world/travel', { targetNodeId });
  }

  getPathPreview(targetNodeId) {
    return this.get(`/world/path/${targetNodeId}`);
  }

  getCurrentNode() {
    return this.get('/world/current');
  }

  // Stamina endpoints
  getCharacterStamina(characterId) {
    return this.get(`/characters/${characterId}/stamina`);
  }

  // Battle endpoints
  startBattle(options = {}) {
    return this.post('/battle/start', options);
  }

  getCurrentBattle() {
    return this.get('/battle/current');
  }

  submitBattleAction(data) {
    const { battleId, actionType, unitId, targetTile, skillId } = data;
    return this.post('/battle/action', { battleId, actionType, unitId, targetTile, skillId });
  }

  getBattleRewards(battleId) {
    return this.get(`/battle/rewards/${battleId}`);
  }

  getEncounterPreview(nodeId) {
    return this.get(`/battle/preview/${nodeId}`);
  }

  // Inventory endpoints
  // Get character's equipped items (shared inventory is separate)
  getInventory(characterId) {
    return this.get(`/inventory/${characterId}`);
  }

  // Get user's shared inventory pool (unequipped items)
  getSharedInventory() {
    return this.get('/inventory/shared');
  }

  equipItem(characterId, itemInstanceId, slot) {
    return this.post('/inventory/equip', { characterId, itemInstanceId, slot });
  }

  unequipItem(characterId, slot) {
    return this.post('/inventory/unequip', { characterId, slot });
  }

  // Use consumable from shared pool on target character
  useItem(itemInstanceId, targetCharacterId) {
    return this.post('/inventory/use', { itemInstanceId, targetCharacterId });
  }

  // Discard item from shared pool
  discardItem(itemInstanceId, quantity = null) {
    return this.post('/inventory/discard', { itemInstanceId, quantity });
  }

  // Skills endpoints
  getSkillTree(guildId) {
    return this.get(`/skills/tree/${guildId}`);
  }

  getCharacterSkills(characterId) {
    return this.get(`/skills/characters/${characterId}/skills`);
  }

  learnSkill(characterId, skillId, levels = 1) {
    return this.post('/skills/learn', { characterId, skillId, levels });
  }

  getGuilds() {
    return this.get('/skills/guilds');
  }

  // Guild advancement endpoints (legacy)
  checkAdvancement(characterId) {
    return this.get(`/skills/advancement/${characterId}`);
  }

  advanceGuild(characterId) {
    return this.post('/skills/advance', { characterId });
  }

  // Advancement Quest endpoints
  getAvailableAdvancementQuests(characterId) {
    return this.get(`/advancement/available/${characterId}`);
  }

  getCurrentAdvancementQuest(characterId) {
    return this.get(`/advancement/current/${characterId}`);
  }

  acceptAdvancementQuest(characterId, questTemplateId) {
    return this.post('/advancement/accept', { characterId, questTemplateId });
  }

  abandonAdvancementQuest(characterId) {
    return this.post(`/advancement/abandon/${characterId}`);
  }

  checkBossTrialEligibility(characterId) {
    return this.get(`/advancement/boss/${characterId}`);
  }

  startBossTrial(characterId) {
    return this.post('/advancement/boss/start', { characterId });
  }

  getAdvancementHistory(characterId) {
    return this.get(`/advancement/history/${characterId}`);
  }

  // Shop endpoints
  getShopInventory(nodeId, shopType) {
    return this.get(`/shops/${nodeId}/${shopType}`);
  }

  buyFromShop(nodeId, shopType, itemTemplateId, quantity = 1, characterId = null) {
    return this.post(`/shops/${nodeId}/${shopType}/buy`, {
      itemTemplateId,
      quantity,
      characterId
    });
  }

  sellToShop(nodeId, shopType, itemInstanceId, quantity = 1) {
    return this.post(`/shops/${nodeId}/${shopType}/sell`, {
      itemInstanceId,
      quantity
    });
  }

  getSellableItems(nodeId, shopType) {
    return this.get(`/shops/${nodeId}/${shopType}/sell-inventory`);
  }

  // Marketplace endpoints
  getOrderBook(itemTemplateId, depth = 20) {
    return this.get(`/marketplace/orderbook/${itemTemplateId}?depth=${depth}`);
  }

  getMyOrders(status = null) {
    const query = status ? `?status=${status}` : '';
    return this.get(`/marketplace/orders/mine${query}`);
  }

  placeLimitOrder(itemTemplateId, side, price, quantity, characterId) {
    return this.post('/marketplace/orders/limit', {
      itemTemplateId,
      side,
      price,
      quantity,
      characterId
    });
  }

  placeMarketOrder(itemTemplateId, side, quantity, characterId) {
    return this.post('/marketplace/orders/market', {
      itemTemplateId,
      side,
      quantity,
      characterId
    });
  }

  cancelOrder(orderId) {
    return this.delete(`/marketplace/orders/${orderId}`);
  }

  searchMarketItems(query = '', type = null, augment = null, limit = 50) {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (type) params.append('type', type);
    if (augment) params.append('augment', augment);
    params.append('limit', limit);
    return this.get(`/marketplace/search?${params.toString()}`);
  }

  getTradeHistory(itemTemplateId, limit = 50) {
    return this.get(`/marketplace/history/${itemTemplateId}?limit=${limit}`);
  }

  getMyTrades(limit = 50) {
    return this.get(`/marketplace/my-trades?limit=${limit}`);
  }

  getMarketStats(itemTemplateId) {
    return this.get(`/marketplace/stats/${itemTemplateId}`);
  }

  // Item listings for unique items with augments
  getItemListings(templateId) {
    return this.get(`/marketplace/items/${templateId}`);
  }

  getMyListings() {
    return this.get('/marketplace/listings/mine');
  }

  /**
   * Get sellable items from user's inventory for marketplace
   * @returns {Promise<{items: Array}>} Items that can be listed
   */
  getSellableInventory() {
    return this.get('/marketplace/inventory/sellable');
  }

  createItemListing(characterId, characterItemId, price) {
    return this.post('/marketplace/listings', {
      characterId,
      characterItemId,
      price
    });
  }

  buyItemListing(listingId, characterId) {
    return this.post(`/marketplace/listings/${listingId}/buy`, { characterId });
  }

  cancelItemListing(listingId) {
    return this.delete(`/marketplace/listings/${listingId}`);
  }

  getPriceSuggestion(characterId, characterItemId) {
    return this.get(`/marketplace/price-suggestion?characterId=${characterId}&characterItemId=${characterItemId}`);
  }

  // Chat endpoints
  getChatHistory(roomType, options = {}) {
    const params = new URLSearchParams();
    if (options.before) params.append('before', options.before);
    if (options.limit) params.append('limit', options.limit);
    if (options.nodeId) params.append('nodeId', options.nodeId);
    if (options.partyId) params.append('partyId', options.partyId);
    const query = params.toString();
    return this.get(`/chat/history/${roomType}${query ? '?' + query : ''}`);
  }

  getDMHistory(targetUserId, options = {}) {
    const params = new URLSearchParams();
    if (options.before) params.append('before', options.before);
    if (options.limit) params.append('limit', options.limit);
    const query = params.toString();
    return this.get(`/chat/dm/${targetUserId}${query ? '?' + query : ''}`);
  }

  getDMConversations(limit = 20) {
    return this.get(`/chat/conversations?limit=${limit}`);
  }

  addReaction(messageId, emoji) {
    return this.post('/chat/reaction', { messageId, emoji });
  }

  removeReaction(messageId, emoji) {
    return this.delete('/chat/reaction', { data: { messageId, emoji } });
  }

  getOnlinePlayers(options = {}) {
    const params = new URLSearchParams();
    if (options.nodeId) params.append('nodeId', options.nodeId);
    if (options.limit) params.append('limit', options.limit);
    const query = params.toString();
    return this.get(`/chat/online${query ? '?' + query : ''}`);
  }

  updatePresence(status, customMessage = null) {
    return this.put('/chat/presence', { status, customMessage });
  }

  getPresence(userId) {
    return this.get(`/chat/presence/${userId}`);
  }

  // Guild recruitment endpoints
  getGuildRecruits(nodeId) {
    return this.get(`/guild/${nodeId}/recruits`);
  }

  purchaseRecruit(nodeId, recruitId) {
    return this.post(`/guild/${nodeId}/recruit/${recruitId}/purchase`);
  }

  getGuildInfo(nodeId) {
    return this.get(`/guild/${nodeId}/info`);
  }

  // Settings endpoints
  getSettings() {
    return this.get('/settings');
  }

  updateSettings(settings) {
    return this.put('/settings', settings);
  }

  // Multiplayer Party endpoints

  /**
   * Create a new multiplayer party
   * @param {string} name - Party name
   * @param {string} partyType - Type: 'pve_coop', 'pvp_team', 'pvp_ffa'
   * @param {number} maxMembers - Maximum members (default 4, max 8)
   * @returns {Promise<{party: Object}>}
   */
  createMultiplayerParty(name, partyType = 'pve_coop', maxMembers = 4) {
    return this.post('/party/multiplayer', { name, partyType, maxMembers });
  }

  /**
   * Get current multiplayer party (if in one)
   * @returns {Promise<{party: Object|null}>}
   */
  getMultiplayerParty() {
    return this.get('/party/multiplayer/current');
  }

  /**
   * Get party details by ID
   * @param {number} partyId - Party ID
   * @returns {Promise<{party: Object}>}
   */
  getMultiplayerPartyById(partyId) {
    return this.get(`/party/multiplayer/${partyId}`);
  }

  /**
   * Invite a player to party by username
   * @param {number} partyId - Party ID
   * @param {string} username - Username to invite
   * @returns {Promise<{success: boolean, invite: Object}>}
   */
  inviteToParty(partyId, username) {
    return this.post(`/party/multiplayer/${partyId}/invite`, { username });
  }

  /**
   * Accept a party invite and join the party
   * @param {number} inviteId - Invite ID
   * @returns {Promise<{success: boolean, party: Object}>}
   */
  acceptPartyInvite(inviteId) {
    return this.post(`/party/multiplayer/join/${inviteId}`);
  }

  /**
   * Decline a party invite
   * @param {number} inviteId - Invite ID
   * @returns {Promise<{success: boolean}>}
   */
  declinePartyInvite(inviteId) {
    return this.post(`/party/multiplayer/decline/${inviteId}`);
  }

  /**
   * Leave a party
   * @param {number} partyId - Party ID
   * @returns {Promise<{success: boolean}>}
   */
  leaveParty(partyId) {
    return this.post(`/party/multiplayer/${partyId}/leave`);
  }

  /**
   * Set ready status in party
   * @param {number} partyId - Party ID
   * @param {boolean} ready - Ready state
   * @returns {Promise<{success: boolean, isReady: boolean, allReady: boolean}>}
   */
  setReady(partyId, ready) {
    return this.put(`/party/multiplayer/${partyId}/ready`, { isReady: ready });
  }

  /**
   * Get pending party invites for current user
   * @returns {Promise<{invites: Array}>}
   */
  getPartyInvites() {
    return this.get('/party/multiplayer/invites');
  }

  /**
   * Start party battle (leader only)
   * @param {number} partyId - Party ID
   * @param {number} nodeId - Node ID for battle
   * @returns {Promise<{success: boolean, nodeId: number, memberIds: Array}>}
   */
  startPartyBattle(partyId, nodeId) {
    return this.post(`/party/multiplayer/${partyId}/start`, { nodeId });
  }

  // LFG (Looking For Group) endpoints

  /**
   * Get active LFG posts
   * @param {Object} options - Filter options
   * @returns {Promise<{posts: Array}>}
   */
  getLFGPosts(options = {}) {
    const params = new URLSearchParams();
    if (options.minLevel) params.append('minLevel', options.minLevel);
    if (options.maxLevel) params.append('maxLevel', options.maxLevel);
    if (options.contentTier) params.append('contentTier', options.contentTier);
    if (options.limit) params.append('limit', options.limit);
    const query = params.toString();
    return this.get(`/lfg${query ? '?' + query : ''}`);
  }

  /**
   * Get current user's active LFG post
   * @returns {Promise<{post: Object|null}>}
   */
  getMyLFGPost() {
    return this.get('/lfg/my-post');
  }

  /**
   * Create a new LFG post
   * @param {Object} postData - Post data
   * @returns {Promise<{post: Object}>}
   */
  createLFGPost(postData) {
    return this.post('/lfg', postData);
  }

  /**
   * Delete own LFG post
   * @param {number} postId - Post ID
   * @returns {Promise<{success: boolean}>}
   */
  deleteLFGPost(postId) {
    return this.delete(`/lfg/${postId}`);
  }

  /**
   * Apply to join an LFG post
   * @param {number} postId - Post ID
   * @param {string} message - Optional message
   * @returns {Promise<{success: boolean, message: string}>}
   */
  applyToLFGPost(postId, message = null) {
    return this.post(`/lfg/${postId}/apply`, { message });
  }

  // Player search endpoint

  /**
   * Search for players by username
   * @param {string} query - Search query
   * @param {number} limit - Max results
   * @returns {Promise<{players: Array}>}
   */
  searchPlayers(query, limit = 20) {
    const params = new URLSearchParams();
    params.append('q', query);
    params.append('limit', limit);
    return this.get(`/players/search?${params.toString()}`);
  }

  // Friends API

  /**
   * Get all friends with online status and activity
   * @returns {Promise<{success: boolean, friends: Array}>}
   */
  getFriends() {
    return this.get('/friends');
  }

  /**
   * Get pending incoming friend requests
   * @returns {Promise<{success: boolean, requests: Array}>}
   */
  getFriendRequests() {
    return this.get('/friends/requests');
  }

  /**
   * Get list of blocked users
   * @returns {Promise<{success: boolean, blocked: Array}>}
   */
  getBlockedUsers() {
    return this.get('/friends/blocked');
  }

  /**
   * Send a friend request to a user by username
   * @param {string} username - Target username
   * @returns {Promise<{success: boolean, message: string, request: Object}>}
   */
  sendFriendRequest(username) {
    return this.post(`/friends/request/${encodeURIComponent(username)}`);
  }

  /**
   * Accept a pending friend request
   * @param {number} requestId - Request ID to accept
   * @returns {Promise<{success: boolean, message: string, friendship: Object}>}
   */
  acceptFriendRequest(requestId) {
    return this.post(`/friends/accept/${requestId}`);
  }

  /**
   * Decline a pending friend request
   * @param {number} requestId - Request ID to decline
   * @returns {Promise<{success: boolean, message: string}>}
   */
  declineFriendRequest(requestId) {
    return this.post(`/friends/decline/${requestId}`);
  }

  /**
   * Remove a friend (unfriend)
   * @param {number} friendId - Friend's user ID to remove
   * @returns {Promise<{success: boolean, message: string}>}
   */
  removeFriend(friendId) {
    return this.delete(`/friends/${friendId}`);
  }

  /**
   * Block a user
   * @param {number} userId - User ID to block
   * @returns {Promise<{success: boolean, message: string, block: Object}>}
   */
  blockUser(userId) {
    return this.post(`/friends/${userId}/block`);
  }

  /**
   * Unblock a user
   * @param {number} userId - User ID to unblock
   * @returns {Promise<{success: boolean, message: string}>}
   */
  unblockUser(userId) {
    return this.delete(`/friends/${userId}/block`);
  }

  /**
   * Update friend metadata (favorite status, note)
   * @param {number} friendId - Friend's user ID
   * @param {Object} updates - Update object
   * @param {boolean} [updates.isFavorite] - Whether friend is a favorite
   * @param {string|null} [updates.note] - Private note about friend (max 256 chars)
   * @returns {Promise<{success: boolean, friendship: Object}>}
   */
  updateFriend(friendId, updates) {
    return this.put(`/friends/${friendId}`, updates);
  }

  // Clans API

  /**
   * List all clans with optional search
   * @param {string} [query] - Optional search query
   * @param {number} [limit=20] - Max results
   * @returns {Promise<{success: boolean, clans: Array}>}
   */
  listClans(query, limit = 20) {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    params.append('limit', limit);
    return this.get(`/clans?${params.toString()}`);
  }

  /**
   * Create a new clan
   * @param {string} name - Clan name (3-32 chars)
   * @param {string} tag - Clan tag (2-6 alphanumeric chars)
   * @param {string} [description] - Optional description
   * @returns {Promise<{success: boolean, message: string, clan: Object}>}
   */
  createClan(name, tag, description) {
    return this.post('/clans', { name, tag, description });
  }

  /**
   * Get the authenticated user's clan
   * @returns {Promise<{success: boolean, clan: Object|null}>}
   */
  getMyClan() {
    return this.get('/clans/my');
  }

  /**
   * Get pending clan invites for the user
   * @returns {Promise<{success: boolean, invites: Array}>}
   */
  getClanInvites() {
    return this.get('/clans/invites');
  }

  /**
   * Get clan details and members
   * @param {number} clanId - Clan ID
   * @returns {Promise<{success: boolean, clan: Object}>}
   */
  getClanDetails(clanId) {
    return this.get(`/clans/${clanId}`);
  }

  /**
   * Leave a clan
   * @param {number} clanId - Clan ID to leave
   * @returns {Promise<{success: boolean, message: string}>}
   */
  leaveClan(clanId) {
    return this.post(`/clans/${clanId}/leave`);
  }

  /**
   * Disband a clan (leader only)
   * @param {number} clanId - Clan ID to disband
   * @returns {Promise<{success: boolean, message: string}>}
   */
  disbandClan(clanId) {
    return this.delete(`/clans/${clanId}`);
  }

  /**
   * Invite a player to the clan
   * @param {number} clanId - Clan ID
   * @param {string} username - Username to invite
   * @returns {Promise<{success: boolean, message: string, invite: Object}>}
   */
  inviteToClan(clanId, username) {
    return this.post(`/clans/${clanId}/invite/${encodeURIComponent(username)}`);
  }

  /**
   * Accept a clan invite
   * @param {number} inviteId - Invite ID to accept
   * @returns {Promise<{success: boolean, message: string, membership: Object}>}
   */
  acceptClanInvite(inviteId) {
    return this.post(`/clans/invite/${inviteId}/accept`);
  }

  /**
   * Decline a clan invite
   * @param {number} inviteId - Invite ID to decline
   * @returns {Promise<{success: boolean, message: string}>}
   */
  declineClanInvite(inviteId) {
    return this.post(`/clans/invite/${inviteId}/decline`);
  }

  /**
   * Get clan chat messages
   * @param {number} clanId - Clan ID
   * @param {number} [limit=50] - Max messages
   * @param {number} [before] - Message ID for pagination
   * @returns {Promise<{success: boolean, messages: Array}>}
   */
  getClanMessages(clanId, limit = 50, before) {
    const params = new URLSearchParams();
    params.append('limit', limit);
    if (before) params.append('before', before);
    return this.get(`/clans/${clanId}/messages?${params.toString()}`);
  }

  /**
   * Send a clan chat message
   * @param {number} clanId - Clan ID
   * @param {string} message - Message text (max 500 chars)
   * @returns {Promise<{success: boolean, message: Object}>}
   */
  sendClanMessage(clanId, message) {
    return this.post(`/clans/${clanId}/messages`, { message });
  }

  // Coliseum / PvP endpoints

  /**
   * Get coliseum leaderboard
   * @param {string} queueType - Queue type: '1v1', '3v3', '5v5'
   * @param {number} limit - Max results (default 100)
   * @param {string} timeFilter - Time filter: 'all', 'week', 'today'
   * @returns {Promise<{leaderboard: Array, userRank: number|null}>}
   */
  getColiseumLeaderboard(queueType = '1v1', limit = 100, timeFilter = 'all') {
    const params = new URLSearchParams();
    params.append('queue', queueType);
    params.append('limit', limit);
    if (timeFilter !== 'all') {
      params.append('time', timeFilter);
    }
    return this.get(`/coliseum/leaderboard?${params.toString()}`);
  }

  /**
   * Get coliseum match history
   * @param {string} filter - Filter: 'all' or 'mine'
   * @param {number} limit - Max results
   * @param {number} offset - Pagination offset
   * @returns {Promise<{matches: Array}>}
   */
  getColiseumMatches(filter = 'all', limit = 20, offset = 0) {
    const params = new URLSearchParams();
    params.append('filter', filter);
    params.append('limit', limit);
    params.append('offset', offset);
    return this.get(`/coliseum/matches?${params.toString()}`);
  }

  /**
   * Get detailed match information
   * @param {number} matchId - Match ID
   * @returns {Promise<{match: Object}>}
   */
  getColiseumMatchDetails(matchId) {
    return this.get(`/coliseum/matches/${matchId}`);
  }

  /**
   * Surrender from current PvP battle
   * @param {number} battleId - Battle ID
   * @returns {Promise<{success: boolean}>}
   */
  surrenderPvPBattle(battleId) {
    return this.post('/coliseum/surrender', { battleId });
  }

  // ============================================
  // LEADERBOARD METHODS
  // ============================================

  /**
   * Get leaderboard for a category
   * @param {string} category - 'pvp', 'level', 'gold', or 'battles'
   * @param {Object} options - Query options
   * @param {string} options.time - 'all', 'week', or 'today'
   * @param {number} options.limit - Number of entries (max 100)
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.queue - Queue type for PvP ('1v1', '3v3', '5v5')
   * @returns {Promise<{category, timeFilter, leaderboard, userEntry, pagination}>}
   */
  getLeaderboard(category, options = {}) {
    const params = new URLSearchParams();
    if (options.time) params.append('time', options.time);
    if (options.limit) params.append('limit', options.limit);
    if (options.offset) params.append('offset', options.offset);
    if (options.queue) params.append('queue', options.queue);
    const queryString = params.toString();
    return this.get(`/leaderboard/${category}${queryString ? '?' + queryString : ''}`);
  }
}
