/**
 * @module WebSocketServer
 * @description Core WebSocket server setup and message handling for Modia MMORPG.
 *
 * Key responsibilities:
 * - WebSocket server initialization and connection handling
 * - Authentication with JWT tokens (10-second timeout)
 * - Message routing to appropriate handlers
 * - Connection lifecycle management (heartbeat, cleanup)
 * - Single connection per user enforcement
 *
 * @see rateLimiter.js - Rate limiting implementation
 * @see roomManager.js - Room subscription management
 * @see messageHandlers.js - Individual message type handlers
 */

import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken } from '../config/jwt.js';
import presenceService from '../services/presenceService.js';
import coliseumService from '../services/coliseumService.js';
import * as marketplaceWebsocket from '../services/marketplaceWebsocket.js';
import * as garrisonWebsocket from './garrisonWebsocket.js';
import { cleanupConnection } from '../services/messageReliability.js';
import { WEBSOCKET_PER_MESSAGE_DEFLATE_OPTIONS } from './compressionConfig.js';
import * as battleReconnection from '../services/battleReconnection.js';
import { battleStateRepository } from '../services/battle/BattleStateRepository.js';

// Import extracted modules
import { checkRateLimit, cleanupUserRateLimits, isInfrastructureMessage } from './rateLimiter.js';
import {
  connections,
  rooms,
  setConnection,
  removeConnection,
  removeUserFromAllRooms,
  isUserOnline,
  getOnlineCount,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  broadcastNodePresenceEvent
} from './roomManager.js';

// Import metrics and logging
import {
  wsLog,
  LogLevel,
  incrementHeartbeatsReceived,
  incrementHeartbeatAcksSent,
  incrementHeartbeatTimeouts,
  incrementConnectionsOpened,
  incrementConnectionsClosed,
  incrementAuthSuccesses,
  incrementAuthFailures,
  incrementAuthTimeouts,
  incrementSessionsReplaced,
  incrementZombiesCleaned,
  incrementStaleConnectionsRejected,
  incrementRateLimitHits,
  incrementMessageErrors,
  incrementUnknownMessageTypes,
  startMetricsReporting,
  stopMetricsReporting
} from './wsMetrics.js';

// Import message handlers
import {
  handleChatMessage,
  handlePrivateMessage,
  handleTypingIndicator,
  handleAddReaction,
  handleRemoveReaction,
  handleJoinRoom,
  handleLeaveRoom,
  handleColiseumQueueJoin,
  handleColiseumQueueLeave,
  handleColiseumReady,
  handleColiseumLobbyJoin,
  handleColiseumLobbyLeave,
  handleColiseumFormationSubmit,
  handleJoinBattle,
  handleLeaveBattle,
  handleBattleSyncRequest,
  handleAckMessage,
  handleBattleSurrender,
  handlePartyLeave,
  handleJoinNode,
  handleLeaveNode,
  handleMarketplaceSubscribe,
  handleMarketplaceUnsubscribe,
  handleJoinGarrison,
  handleLeaveGarrison,
  handleGenerationCancel,
  handleGenerationCancelAll,
  handleGenerationPause,
  handleGenerationResume,
  handleAudioCancel,
  handleAudioCancelAll,
  handleAudioPause,
  handleAudioResume,
  handlePresenceUpdate
} from './messageHandlers.js';

// ============================================================
// Heartbeat Tracking
// ============================================================

const lastHeartbeat = new Map(); // userId -> timestamp
const HEARTBEAT_TIMEOUT_MS = 30000; // Close zombie connections after 30s (aligned with client 10-25s detection)

// ============================================================
// Connection ID Tracking (for reconnection validation)
// ============================================================

// Maps userId -> current valid connectionId
// Used to detect and reject messages from stale connections
const activeConnectionIds = new Map();

// ============================================================
// WebSocket Server Setup
// ============================================================

function setupWebSocket(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    perMessageDeflate: WEBSOCKET_PER_MESSAGE_DEFLATE_OPTIONS
  });

  // Initialize marketplace WebSocket service with server references
  marketplaceWebsocket.initialize(wss, rooms, connections);

  // Authentication timeout duration (10 seconds)
  const AUTH_TIMEOUT_MS = 10000;

  // Start metrics reporting
  // Note: interval is managed internally by wsMetrics, stopMetricsReporting() called on close
  startMetricsReporting(
    () => connections.size,
    () => rooms.size
  );

  wss.on('connection', (ws) => {
    let userId = null;
    let username = null;
    let connectionId = null; // Track this connection's unique ID

    ws.isAlive = true;
    incrementConnectionsOpened();

    wsLog(LogLevel.DEBUG, 'connection_opened', {
      clientCount: wss.clients.size
    });

    // SECURITY: Set authentication timeout
    const authTimeout = setTimeout(() => {
      if (!userId) {
        incrementAuthTimeouts();
        wsLog(LogLevel.WARN, 'auth_timeout', {
          reason: 'No authentication within timeout period',
          timeoutMs: AUTH_TIMEOUT_MS
        });
        ws.send(JSON.stringify({
          type: 'auth_timeout',
          payload: { message: 'Authentication required within 10 seconds' }
        }));
        ws.close(1008, 'Authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        const { type, payload } = message;

        // Connection ID validation (skip for auth messages)
        // Reject messages from stale connections that haven't been fully closed yet
        if (userId && type !== 'auth' && connectionId) {
          const activeConnId = activeConnectionIds.get(userId);
          if (activeConnId && activeConnId !== connectionId) {
            incrementStaleConnectionsRejected();
            wsLog(LogLevel.WARN, 'stale_connection_rejected', {
              userId,
              staleConnectionId: connectionId,
              activeConnectionId: activeConnId,
              messageType: type
            });
            ws.send(JSON.stringify({
              type: 'error',
              payload: {
                message: 'Connection superseded by newer session',
                code: 'STALE_CONNECTION'
              }
            }));
            // Close this stale connection
            ws.close(1000, 'Connection superseded');
            return;
          }
        }

        // Rate limit check (skip for auth and infrastructure messages)
        if (userId && type !== 'auth' && !isInfrastructureMessage(type)) {
          const rateCheck = await checkRateLimit(userId, type);
          if (rateCheck.limited) {
            incrementRateLimitHits();
            wsLog(LogLevel.WARN, 'rate_limited', {
              userId,
              messageType: type,
              category: rateCheck.category,
              retryAfter: rateCheck.retryAfter
            });
            ws.send(JSON.stringify({
              type: 'rate_limited',
              payload: {
                message: 'Too many messages. Please slow down.',
                category: rateCheck.category,
                retryAfter: rateCheck.retryAfter,
                blockedMessageType: type
              }
            }));
            return;
          }
        }

        switch (type) {
          case 'auth':
            handleAuth(ws, payload, authTimeout, (id, name, connId) => {
              userId = id;
              username = name;
              connectionId = connId;
            });
            break;

          case 'join_room':
            await handleJoinRoom(ws, userId, username, payload);
            break;

          case 'leave_room':
            handleLeaveRoom(ws, userId, payload);
            break;

          case 'chat_message':
            await handleChatMessage(ws, userId, username, payload);
            break;

          case 'private_message':
            await handlePrivateMessage(ws, userId, username, payload);
            break;

          case 'typing_indicator':
            handleTypingIndicator(ws, userId, username, payload);
            break;

          case 'add_reaction':
            await handleAddReaction(ws, userId, username, payload);
            break;

          case 'remove_reaction':
            await handleRemoveReaction(ws, userId, payload);
            break;

          case 'coliseum_queue_join':
            await handleColiseumQueueJoin(ws, userId, username, payload);
            break;

          case 'coliseum_queue_leave':
            await handleColiseumQueueLeave(userId, payload);
            break;

          case 'coliseum_ready':
            await handleColiseumReady(ws, userId, payload);
            break;

          case 'coliseum_lobby_join':
            handleColiseumLobbyJoin(userId);
            break;

          case 'coliseum_lobby_leave':
            handleColiseumLobbyLeave(userId);
            break;

          case 'coliseum_formation_submit':
            await handleColiseumFormationSubmit(ws, userId, payload);
            break;

          case 'join_battle':
            await handleJoinBattle(ws, userId, payload);
            break;

          case 'leave_battle':
            handleLeaveBattle(userId, payload);
            break;

          case 'battle:surrender':
            await handleBattleSurrender(ws, userId, payload);
            break;

          case 'party_leave':
            handlePartyLeave(ws, userId);
            break;

          case 'join_node':
            await handleJoinNode(ws, userId, username, payload);
            break;

          case 'leave_node':
            handleLeaveNode(userId, username, payload);
            break;

          case 'marketplace_subscribe':
            handleMarketplaceSubscribe(ws, userId, payload);
            break;

          case 'marketplace_unsubscribe':
            handleMarketplaceUnsubscribe(ws, userId, payload);
            break;

          case 'join_garrison':
            await handleJoinGarrison(ws, userId, payload);
            break;

          case 'leave_garrison':
            handleLeaveGarrison(ws, userId, payload);
            break;

          case 'presence_update':
            await handlePresenceUpdate(ws, userId, username, payload, broadcastPresenceChange);
            break;

          case 'generation:cancel':
            handleGenerationCancel(ws, userId, payload);
            break;

          case 'generation:cancel_all':
            handleGenerationCancelAll(ws, userId);
            break;

          case 'generation:pause':
            handleGenerationPause(ws, userId);
            break;

          case 'generation:resume':
            handleGenerationResume(ws, userId);
            break;

          case 'audio:cancel':
            handleAudioCancel(ws, userId, payload);
            break;

          case 'audio:cancel_all':
            handleAudioCancelAll(ws, userId);
            break;

          case 'audio:pause':
            handleAudioPause(ws, userId);
            break;

          case 'audio:resume':
            handleAudioResume(ws, userId);
            break;

          case 'ack':
            handleAckMessage(userId, message);
            break;

          case 'heartbeat':
            handleHeartbeat(ws, userId, payload);
            break;

          case 'battle:request_sync':
            await handleBattleSyncRequest(ws, userId, message);
            break;

          default:
            incrementUnknownMessageTypes();
            wsLog(LogLevel.WARN, 'unknown_message_type', {
              userId,
              messageType: type
            });
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: 'Unknown message type' }
            }));
        }
      } catch (err) {
        incrementMessageErrors();
        wsLog(LogLevel.ERROR, 'message_error', {
          userId,
          error: err.message
        });
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid message format' }
        }));
      }
    });

    ws.on('close', (code, reason) => {
      incrementConnectionsClosed();
      clearTimeout(authTimeout);

      // Log close with reason (but not for every normal close)
      if (code !== 1000 && code !== 1001) {
        wsLog(LogLevel.INFO, 'connection_closed', {
          userId,
          code,
          reason: reason?.toString() || 'unknown'
        });
      } else {
        wsLog(LogLevel.DEBUG, 'connection_closed', {
          userId,
          code,
          reason: reason?.toString() || 'normal'
        });
      }

      handleDisconnect(userId, username, ws, connectionId);
    });

    ws.on('error', (err) => {
      wsLog(LogLevel.ERROR, 'connection_error', {
        userId,
        error: err.message
      });
    });
  });

  // Heartbeat to detect dead connections (server-side ping/pong)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Zombie connection cleanup based on client heartbeats
  const heartbeatCleanupInterval = setInterval(() => {
    const now = Date.now();
    let zombiesThisCycle = 0;
    for (const [connId, lastTime] of lastHeartbeat) {
      if (now - lastTime > HEARTBEAT_TIMEOUT_MS) {
        const ws = connections.get(connId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          incrementZombiesCleaned();
          incrementHeartbeatTimeouts();
          zombiesThisCycle++;
          // Suppress log noise for dev admin dashboard (userId=-999)
          if (connId !== -999) {
            wsLog(LogLevel.WARN, 'zombie_connection_cleaned', {
              userId: connId,
              lastHeartbeatAgo: now - lastTime,
              timeoutMs: HEARTBEAT_TIMEOUT_MS
            });
          }
          ws.close(1000, 'Heartbeat timeout');
          // Explicit cleanup in case handleDisconnect doesn't fire
          activeConnectionIds.delete(connId);
        }
        lastHeartbeat.delete(connId);
      }
    }
    // Log summary if any zombies were cleaned
    if (zombiesThisCycle > 0) {
      wsLog(LogLevel.INFO, 'zombie_cleanup_cycle', {
        zombiesCleaned: zombiesThisCycle,
        remainingConnections: connections.size
      });
    }
  }, 15000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(heartbeatCleanupInterval);
    stopMetricsReporting();
    wsLog(LogLevel.INFO, 'server_closed', {
      finalConnectionCount: connections.size,
      finalRoomCount: rooms.size
    });
  });

  return wss;
}

// ============================================================
// Authentication Handler
// ============================================================

function handleAuth(ws, payload, authTimeout, setCredentials) {
  try {
    // Extract connectionId from payload (may be missing for legacy clients)
    const clientConnectionId = payload.connectionId;

    // DEV ONLY: Special admin token (env-configurable with safe default)
    const adminDevToken = process.env.ADMIN_WS_DEV_TOKEN || 'dev_admin_token';
    if (payload.token === adminDevToken && process.env.NODE_ENV !== 'production') {
      const userId = -999;
      const username = 'admin_dashboard';
      const connectionId = clientConnectionId || `admin_${Date.now()}`;

      setCredentials(userId, username, connectionId);
      setConnection(userId, ws);
      lastHeartbeat.set(userId, Date.now());
      activeConnectionIds.set(userId, connectionId);
      clearTimeout(authTimeout);
      incrementAuthSuccesses();

      wsLog(LogLevel.DEBUG, 'auth_success', {
        userId,
        username,
        isAdmin: true,
        connectionId
      });

      ws.send(JSON.stringify({
        type: 'auth_success',
        payload: { userId, username, isAdmin: true, connectionId }
      }));
      return;
    }

    const decoded = verifyAccessToken(payload.token);
    const userId = decoded.userId;
    const username = decoded.username;

    // Generate connectionId: use client-provided or generate server-side fallback
    const connectionId = clientConnectionId || `server_${userId}_${Date.now()}`;

    // Log connectionId status for debugging
    if (!clientConnectionId) {
      wsLog(LogLevel.DEBUG, 'connection_id_generated', {
        userId,
        connectionId,
        reason: 'No client connectionId provided'
      });
    } else {
      wsLog(LogLevel.DEBUG, 'connection_id_received', {
        userId,
        connectionId
      });
    }

    // SECURITY: Limit to 1 connection per user - IMMEDIATE handoff
    const existingConnection = connections.get(userId);
    if (existingConnection && existingConnection !== ws && existingConnection.readyState === WebSocket.OPEN) {
      // Immediately invalidate old connection's heartbeat tracking
      // This prevents race conditions where old connection might still send messages
      lastHeartbeat.delete(userId);

      // Get old connectionId before replacing
      const oldConnectionId = activeConnectionIds.get(userId);
      incrementSessionsReplaced();

      wsLog(LogLevel.INFO, 'session_replaced', {
        userId,
        oldConnectionId: oldConnectionId || 'unknown',
        newConnectionId: connectionId
      });

      // Send session_replaced and close immediately (don't wait for zombie cleanup)
      existingConnection.send(JSON.stringify({
        type: 'session_replaced',
        payload: {
          message: 'Another session has connected',
          replacedBy: connectionId
        }
      }));
      existingConnection.close(1000, 'Session replaced by new connection');
    }

    setCredentials(userId, username, connectionId);
    setConnection(userId, ws);
    lastHeartbeat.set(userId, Date.now());
    activeConnectionIds.set(userId, connectionId);
    clearTimeout(authTimeout);
    incrementAuthSuccesses();

    wsLog(LogLevel.INFO, 'auth_success', {
      userId,
      username,
      connectionId,
      totalConnections: connections.size
    });

    presenceService.setPresence(userId, 'online').catch(err => {
      wsLog(LogLevel.ERROR, 'presence_error', {
        userId,
        error: err.message
      });
    });

    broadcastPresenceChange(userId, username, 'online');

    ws.send(JSON.stringify({
      type: 'auth_success',
      payload: { userId, username, connectionId }
    }));
  } catch {
    incrementAuthFailures();
    wsLog(LogLevel.WARN, 'auth_failure', {
      reason: 'Invalid token'
    });
    ws.send(JSON.stringify({
      type: 'auth_error',
      payload: { message: 'Invalid token' }
    }));
  }
}

// ============================================================
// Heartbeat Handler
// ============================================================

function handleHeartbeat(ws, userId, payload) {
  if (!userId) return;
  lastHeartbeat.set(userId, Date.now());
  incrementHeartbeatsReceived();
  incrementHeartbeatAcksSent();

  // Don't log every heartbeat - too noisy
  // Only log in DEBUG mode for troubleshooting
  wsLog(LogLevel.DEBUG, 'heartbeat', {
    userId,
    clientTimestamp: payload?.timestamp,
    id: payload?.id
  });

  ws.send(JSON.stringify({
    type: 'heartbeat_ack',
    timestamp: payload?.timestamp ?? Date.now(),
    id: payload?.id,
    serverTime: Date.now()
  }));
}

// ============================================================
// Disconnect Handler
// ============================================================

function handleDisconnect(userId, username, ws = null, connectionId = null) {
  if (!userId) return;

  // Session replacement guard: if this socket is no longer the active connection
  // for this user, skip user-level cleanup. The newer session owns those resources.
  const currentWs = connections.get(userId);
  if (ws !== null && currentWs !== ws) {
    wsLog(LogLevel.DEBUG, 'disconnect_stale_socket', {
      userId,
      connectionId,
      reason: 'Socket replaced by newer session'
    });
    // Do NOT call cleanupConnection here - pendingAcks is keyed by userId and
    // belongs to the NEW session, not this closing stale socket. Just log and return.
    return;
  }

  // Guard connectionId delete - only delete if it matches a different registered ID.
  // When currentConnId is undefined (e.g., zombie cleanup), allow full cleanup.
  const currentConnId = activeConnectionIds.get(userId);
  if (connectionId !== null && currentConnId !== undefined && currentConnId !== connectionId) {
    wsLog(LogLevel.DEBUG, 'disconnect_stale_connection_id', {
      userId,
      connectionId,
      currentConnId,
      reason: 'ConnectionId replaced by newer session'
    });
    // Do NOT call cleanupConnection here - pendingAcks is keyed by userId and
    // belongs to the NEW session, not this closing stale socket.
    return;
  }

  wsLog(LogLevel.DEBUG, 'disconnect_cleanup', {
    userId,
    username
  });

  removeConnection(userId, ws);
  lastHeartbeat.delete(userId);
  activeConnectionIds.delete(userId);
  cleanupConnection(userId);
  cleanupUserRateLimits(userId);

  // Handle battle disconnect for non-coliseum battles (fire-and-forget)
  // Coliseum battles are handled by coliseumService.cleanupPlayer below
  battleStateRepository.findActiveBattleForPlayer(userId)
    .then(async (battle) => {
      if (battle && battle.battleType !== 'pvp_coliseum') {
        await battleReconnection.handleDisconnect(
          battle.battleId ?? battle.id,
          userId,
          username
        );
      }
    })
    .catch(err => {
      wsLog(LogLevel.ERROR, 'battle_disconnect_error', {
        userId,
        error: err.message
      });
    });

  presenceService.setOffline(userId).catch(err => {
    wsLog(LogLevel.ERROR, 'presence_offline_error', {
      userId,
      error: err.message
    });
  });

  const removedNodes = presenceService.clearUserFromAllNodes(userId);
  removedNodes.forEach(nodeId => {
    // Privacy-gated: hidden users never announced entering, so no leave either.
    broadcastNodePresenceEvent(nodeId, {
      type: 'player:left_node',
      payload: {
        nodeId,
        userId,
        username,
        reason: 'disconnected',
        timestamp: Date.now()
      }
    }, userId).catch(() => {});
  });

  coliseumService.cleanupPlayer(userId);
  marketplaceWebsocket.cleanupUserSubscriptions(userId);
  garrisonWebsocket.cleanupUserGarrisonSubscriptions(userId, rooms);

  broadcastPresenceChange(userId, username, 'offline');

  removeUserFromAllRooms(userId, (roomName) => {
    broadcastToRoom(roomName, {
      type: 'user_left',
      payload: { room: roomName, userId }
    });
  });
}

// Re-export garrison broadcast functions
const { broadcastGarrisonPurchase, broadcastGarrisonRefresh } = garrisonWebsocket;

export {
  setupWebSocket,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  broadcastNodePresenceEvent,
  getOnlineCount,
  isUserOnline,
  connections,
  rooms,
  broadcastGarrisonPurchase,
  broadcastGarrisonRefresh
};

export default {
  setupWebSocket,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  broadcastNodePresenceEvent,
  getOnlineCount,
  isUserOnline,
  connections,
  rooms,
  broadcastGarrisonPurchase,
  broadcastGarrisonRefresh
};
