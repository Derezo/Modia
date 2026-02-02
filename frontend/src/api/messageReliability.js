/**
 * MessageReliabilityManager - Client-side ACK sender and deduplication system
 *
 * Handles reliable message delivery for battle WebSocket messages:
 * - Sends ACKs for messages that require acknowledgment
 * - Deduplicates messages using sequence numbers
 * - Detects sequence gaps and requests resync
 * - Maintains rolling window of processed sequences per battle
 *
 * @example
 * const reliabilityManager = new MessageReliabilityManager((msg) => ws.send(JSON.stringify(msg)));
 *
 * ws.onmessage = (event) => {
 *   const message = JSON.parse(event.data);
 *   const processed = reliabilityManager.handleMessage(message);
 *   if (!processed) return; // Duplicate, skip
 *   // Continue with normal handling...
 * };
 */

import { debugLog } from '../utils/debugLogger.js';

export class MessageReliabilityManager {
  /**
   * @param {Function} sendFn - Function to send WebSocket messages
   */
  constructor(sendFn) {
    this.send = sendFn;
    this.processedSeqs = new Map(); // battleId -> Set<seq>
    this.lastSeq = new Map();       // battleId -> lastProcessedSeq
    this.maxStoredSeqs = 100;       // Rolling window size

    // Fire-and-forget deduplication (for non-ACK messages)
    this.fireAndForgetCache = new Map(); // key -> timestamp
    this.fireAndForgetWindow = 100; // ms window for deduplication
    this.fireAndForgetMaxSize = 50; // Max entries before cleanup
  }

  /**
   * Handle an incoming message, sending ACK and checking for duplicates
   * @param {Object} message - The parsed WebSocket message
   * @returns {Object|null} The message if it should be processed, null if duplicate
   */
  handleMessage(message) {
    // If message doesn't require acknowledgment, return unchanged
    if (!message.ack) {
      return message;
    }

    const { seq, battleId } = message;

    // Validate required fields for ack messages
    if (seq === undefined || !battleId) {
      console.warn('[Reliability] ACK message missing seq or battleId:', message);
      return message; // Process anyway, but log warning
    }

    // Send ACK immediately
    this.sendAck(battleId, seq);

    // Check if this is a duplicate
    if (this.isDuplicate(battleId, seq)) {
      debugLog('network.logWebSocketMessages', `[Reliability] Duplicate message ignored: battle=${battleId} seq=${seq}`);
      return null;
    }

    // Check for sequence gaps
    this.checkForGap(battleId, seq);

    // Mark as processed
    this.markProcessed(battleId, seq);

    return message;
  }

  /**
   * Send an acknowledgment for a received message
   * @param {string} battleId - The battle ID
   * @param {number} seq - The sequence number to acknowledge
   */
  sendAck(battleId, seq) {
    debugLog('network.logWebSocketMessages', `[Reliability] Sending ACK: battle=${battleId} seq=${seq}`);
    this.send({
      type: 'ack',
      battleId,
      seq
    });
  }

  /**
   * Check if a message with this sequence has already been processed
   * @param {string} battleId - The battle ID
   * @param {number} seq - The sequence number
   * @returns {boolean} True if duplicate
   */
  isDuplicate(battleId, seq) {
    const seqs = this.processedSeqs.get(battleId);
    if (!seqs) {
      return false;
    }
    return seqs.has(seq);
  }

  /**
   * Check for gaps in the sequence and request resync if needed
   * @param {string} battleId - The battle ID
   * @param {number} seq - The current sequence number
   */
  checkForGap(battleId, seq) {
    const lastProcessed = this.lastSeq.get(battleId);

    // If this is the first message or sequential, no gap
    if (lastProcessed === undefined) {
      return;
    }

    // Check for gap (missed messages)
    if (seq > lastProcessed + 1) {
      const missedCount = seq - lastProcessed - 1;
      console.warn(`[Reliability] Sequence gap detected: battle=${battleId}, expected=${lastProcessed + 1}, got=${seq}, missed=${missedCount}`);
      this.requestResync(battleId);
    }
  }

  /**
   * Mark a sequence number as processed
   * @param {string} battleId - The battle ID
   * @param {number} seq - The sequence number
   */
  markProcessed(battleId, seq) {
    // Initialize set if needed
    if (!this.processedSeqs.has(battleId)) {
      this.processedSeqs.set(battleId, new Set());
    }

    const seqs = this.processedSeqs.get(battleId);
    seqs.add(seq);

    // Update last processed sequence
    const lastProcessed = this.lastSeq.get(battleId);
    if (lastProcessed === undefined || seq > lastProcessed) {
      this.lastSeq.set(battleId, seq);
    }

    // Prune old sequences if exceeding max
    if (seqs.size > this.maxStoredSeqs) {
      this.pruneOldSequences(battleId);
    }
  }

  /**
   * Remove oldest sequences to maintain rolling window
   * @param {string} battleId - The battle ID
   */
  pruneOldSequences(battleId) {
    const seqs = this.processedSeqs.get(battleId);
    if (!seqs || seqs.size <= this.maxStoredSeqs) {
      return;
    }

    // Convert to sorted array and keep only the most recent
    const sorted = Array.from(seqs).sort((a, b) => a - b);
    const toRemove = sorted.slice(0, sorted.length - this.maxStoredSeqs);

    for (const seq of toRemove) {
      seqs.delete(seq);
    }

    debugLog('network.logWebSocketMessages', `[Reliability] Pruned ${toRemove.length} old sequences for battle=${battleId}`);
  }

  /**
   * Request a full state resync from the server
   * @param {string} battleId - The battle ID
   */
  requestResync(battleId) {
    console.log(`[Reliability] Requesting resync for battle=${battleId}`);
    this.send({
      type: 'battle:request_sync',
      battleId
    });
  }

  /**
   * Clean up tracking data for a battle
   * Called when a battle ends or player leaves
   * @param {string} battleId - The battle ID
   */
  cleanup(battleId) {
    this.processedSeqs.delete(battleId);
    this.lastSeq.delete(battleId);
    // Clear fire-and-forget entries for this battle
    for (const [key] of this.fireAndForgetCache) {
      if (key.includes(battleId)) {
        this.fireAndForgetCache.delete(key);
      }
    }
    debugLog('network.logWebSocketMessages', `[Reliability] Cleaned up tracking for battle=${battleId}`);
  }

  /**
   * Get debug info about current state
   * @returns {Object} Debug information
   */
  getDebugInfo() {
    const info = {};
    for (const [battleId, seqs] of this.processedSeqs) {
      info[battleId] = {
        processedCount: seqs.size,
        lastSeq: this.lastSeq.get(battleId),
        sequences: Array.from(seqs).sort((a, b) => a - b)
      };
    }
    return info;
  }

  /**
   * Generate a deduplication key for fire-and-forget messages
   * @param {Object} message - The message
   * @returns {string} A unique key for this message
   */
  getFireAndForgetKey(message) {
    const type = message.type || '';
    const battleId = message.battleId || '';

    // Create key based on message content that defines uniqueness
    switch (type) {
      case 'battle:state_update':
        return `${type}:${battleId}:${message.state?.activeUnitId}`;
      case 'battle:intent_highlight':
        return `${type}:${battleId}:${message.unitId}:${message.highlightType}`;
      case 'battle:enemy_actions':
        return `${type}:${battleId}:${message.actions?.length}`;
      default:
        return `${type}:${battleId}:${JSON.stringify(message).slice(0, 100)}`;
    }
  }

  /**
   * Check if a fire-and-forget message is a duplicate within the time window
   * @param {Object} message - The message to check
   * @returns {boolean} True if this is a duplicate that should be skipped
   */
  isFireAndForgetDuplicate(message) {
    const key = this.getFireAndForgetKey(message);
    const now = Date.now();

    // Check if we've seen this message recently
    const lastSeen = this.fireAndForgetCache.get(key);
    if (lastSeen && (now - lastSeen) < this.fireAndForgetWindow) {
      debugLog('network.logWebSocketMessages', `[Reliability] Fire-and-forget duplicate: ${key}`);
      return true;
    }

    // Track this message
    this.fireAndForgetCache.set(key, now);

    // Cleanup if cache is too large
    if (this.fireAndForgetCache.size > this.fireAndForgetMaxSize) {
      this.cleanupFireAndForgetCache();
    }

    return false;
  }

  /**
   * Remove old entries from the fire-and-forget cache
   */
  cleanupFireAndForgetCache() {
    const now = Date.now();
    const expiry = this.fireAndForgetWindow * 2; // Keep entries for 2x the window

    for (const [key, timestamp] of this.fireAndForgetCache) {
      if (now - timestamp > expiry) {
        this.fireAndForgetCache.delete(key);
      }
    }

    debugLog('network.logWebSocketMessages', `[Reliability] Fire-and-forget cache cleaned, size: ${this.fireAndForgetCache.size}`);
  }
}
