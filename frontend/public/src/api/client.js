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

  createCharacter(name, race, characterClass) {
    return this.post('/characters', { name, race, characterClass });
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

  getNode(id) {
    return this.get(`/world/nodes/${id}`);
  }

  travel(targetNodeId) {
    return this.post('/world/travel', { targetNodeId });
  }

  getCurrentNode() {
    return this.get('/world/current');
  }

  // Battle endpoints
  startBattle() {
    return this.post('/battle/start');
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

  // Inventory endpoints
  getInventory(characterId) {
    return this.get(`/inventory/${characterId}`);
  }

  equipItem(characterId, itemInstanceId, slot) {
    return this.post('/inventory/equip', { characterId, itemInstanceId, slot });
  }

  unequipItem(characterId, slot) {
    return this.post('/inventory/unequip', { characterId, slot });
  }

  useItem(characterId, itemInstanceId, targetCharacterId = null) {
    return this.post('/inventory/use', { characterId, itemInstanceId, targetCharacterId });
  }

  discardItem(characterId, itemInstanceId, quantity = null) {
    return this.post('/inventory/discard', { characterId, itemInstanceId, quantity });
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

  // Guild advancement endpoints
  checkAdvancement(characterId) {
    return this.get(`/skills/advancement/${characterId}`);
  }

  advanceGuild(characterId) {
    return this.post('/skills/advance', { characterId });
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

  searchMarketItems(query = '', type = null, limit = 50) {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (type) params.append('type', type);
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
}
