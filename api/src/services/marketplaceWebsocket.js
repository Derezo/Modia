/**
 * Marketplace WebSocket Service
 * Handles real-time order book updates and trade notifications
 */

let _wss = null;
let _rooms = null;
let _userSockets = null;

/**
 * Initialize with WebSocket server references
 * Called from websocket/index.js during server startup
 */
export function initialize(wss, rooms, userSockets) {
  _wss = wss;
  _rooms = rooms;
  _userSockets = userSockets;
}

/**
 * Send message to specific user
 */
function sendToUser(userId, message) {
  const userIdStr = String(userId);
  if (_userSockets?.has(userIdStr)) {
    const ws = _userSockets.get(userIdStr);
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(message));
    }
  }
}

/**
 * Broadcast to a room
 */
function broadcastToRoom(roomName, message) {
  if (!_rooms?.has(roomName)) return;

  const messageStr = JSON.stringify(message);
  const userIds = _rooms.get(roomName);

  for (const userId of userIds) {
    if (_userSockets?.has(String(userId))) {
      const ws = _userSockets.get(String(userId));
      if (ws.readyState === 1) {
        ws.send(messageStr);
      }
    }
  }
}

/**
 * Broadcast order book update to subscribers of a specific item
 */
export function broadcastOrderBookUpdate(itemTemplateId, orderBook) {
  const itemRoom = `marketplace:item:${itemTemplateId}`;

  broadcastToRoom(itemRoom, {
    type: 'marketplace:orderbook_update',
    payload: {
      itemTemplateId,
      bids: orderBook.bids || [],
      asks: orderBook.asks || [],
      bestBid: orderBook.bestBid,
      bestAsk: orderBook.bestAsk,
      spread: orderBook.spread,
      lastTradePrice: orderBook.lastTradePrice,
      timestamp: Date.now()
    }
  });

  // Also broadcast to general marketplace room
  broadcastToRoom('marketplace', {
    type: 'marketplace:item_update',
    payload: {
      itemTemplateId,
      bestBid: orderBook.bestBid,
      bestAsk: orderBook.bestAsk,
      timestamp: Date.now()
    }
  });
}

/**
 * Notify user when their order is filled (fully or partially)
 */
export function notifyOrderFilled(userId, trade) {
  sendToUser(userId, {
    type: 'marketplace:order_filled',
    payload: {
      orderId: trade.orderId,
      side: trade.side,
      itemTemplateId: trade.itemTemplateId,
      itemName: trade.itemName,
      price: trade.price,
      quantity: trade.quantity,
      totalGold: trade.totalGold,
      remainingQuantity: trade.remainingQuantity,
      orderStatus: trade.orderStatus, // 'filled' or 'partial'
      newGoldBalance: trade.newGoldBalance,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast trade execution to item subscribers
 */
export function broadcastTrade(trade) {
  const itemRoom = `marketplace:item:${trade.itemTemplateId}`;

  broadcastToRoom(itemRoom, {
    type: 'marketplace:trade_executed',
    payload: {
      itemTemplateId: trade.itemTemplateId,
      itemName: trade.itemName,
      price: trade.price,
      quantity: trade.quantity,
      timestamp: Date.now()
    }
  });
}

/**
 * Notify user of order cancellation confirmation
 */
export function notifyOrderCancelled(userId, order) {
  sendToUser(userId, {
    type: 'marketplace:order_cancelled',
    payload: {
      orderId: order.orderId,
      itemTemplateId: order.itemTemplateId,
      refundedGold: order.refundedGold,
      returnedItems: order.returnedItems,
      timestamp: Date.now()
    }
  });
}

/**
 * Notify user when their order expires
 */
export function notifyOrderExpired(userId, order) {
  sendToUser(userId, {
    type: 'marketplace:order_expired',
    payload: {
      orderId: order.orderId,
      itemTemplateId: order.itemTemplateId,
      side: order.side,
      refundedGold: order.refundedGold,
      returnedItems: order.returnedItems,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast price alert to subscribers when price crosses threshold
 */
export function broadcastPriceAlert(itemTemplateId, alert) {
  const itemRoom = `marketplace:item:${itemTemplateId}`;

  broadcastToRoom(itemRoom, {
    type: 'marketplace:price_alert',
    payload: {
      itemTemplateId,
      alertType: alert.type, // 'above' or 'below'
      threshold: alert.threshold,
      currentPrice: alert.currentPrice,
      timestamp: Date.now()
    }
  });
}

/**
 * Get list of item rooms a user is subscribed to
 */
export function getUserItemSubscriptions(userId) {
  const subscriptions = [];
  if (!_rooms) return subscriptions;

  for (const [roomName, userIds] of _rooms.entries()) {
    if (roomName.startsWith('marketplace:item:') && userIds.has(userId)) {
      const itemTemplateId = parseInt(roomName.split(':')[2], 10);
      subscriptions.push(itemTemplateId);
    }
  }

  return subscriptions;
}

/**
 * Clean up all marketplace item subscriptions for a user
 * Called when user disconnects
 */
export function cleanupUserSubscriptions(userId) {
  if (!_rooms) return;

  for (const [roomName, userIds] of _rooms.entries()) {
    if (roomName.startsWith('marketplace:item:')) {
      userIds.delete(userId);
      if (userIds.size === 0) {
        _rooms.delete(roomName);
      }
    }
  }
}

export default {
  initialize,
  broadcastOrderBookUpdate,
  notifyOrderFilled,
  broadcastTrade,
  notifyOrderCancelled,
  notifyOrderExpired,
  broadcastPriceAlert,
  getUserItemSubscriptions,
  cleanupUserSubscriptions
};
