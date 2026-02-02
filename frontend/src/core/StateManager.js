import { debugLog } from '../utils/debugLogger.js';

export class StateManager {
  constructor() {
    this.state = {
      // Auth
      user: null,
      token: null,
      refreshToken: null,

      // Characters
      characters: [],
      activeCharacter: null,
      battleParty: [],

      // World
      worldSeed: null,
      worldNodes: new Map(),
      currentNode: null,

      // Battle
      currentBattle: null,
      battleState: null,

      // UI
      currentScene: 'login',
      modals: [],
      notifications: [],

      // Real-time
      chatMessages: [],
      onlineUsers: [],
      marketListings: [],
      leaderboard: {}
    };

    this.listeners = new Map();
  }

  get(key) {
    const keys = key.split('.');
    let value = this.state;

    for (const k of keys) {
      if (value === null || value === undefined) return undefined;
      value = value[k];
    }

    return value;
  }

  set(key, value) {
    const keys = key.split('.');
    const lastKey = keys.pop();

    let target = this.state;
    for (const k of keys) {
      if (!(k in target)) target[k] = {};
      target = target[k];
    }

    const oldValue = target[lastKey];
    target[lastKey] = value;

    debugLog('state.logStateChanges', `State change: ${key}`, { oldValue, newValue: value });

    this.notify(key, value, oldValue);
  }

  update(key, partial) {
    const current = this.get(key);
    if (typeof current === 'object' && current !== null) {
      this.set(key, { ...current, ...partial });
    } else {
      this.set(key, partial);
    }
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);

    return () => {
      this.listeners.get(key).delete(callback);
    };
  }

  notify(key, newValue, oldValue) {
    // Notify exact key listeners
    const keyListeners = this.listeners.get(key);
    if (keyListeners) {
      keyListeners.forEach(cb => cb(newValue, oldValue));
    }

    // Notify parent key listeners
    const parts = key.split('.');
    while (parts.length > 1) {
      parts.pop();
      const parentKey = parts.join('.');
      const parentListeners = this.listeners.get(parentKey);
      if (parentListeners) {
        parentListeners.forEach(cb => cb(this.get(parentKey)));
      }
    }
  }

  persist() {
    const authData = {
      token: this.state.token,
      refreshToken: this.state.refreshToken,
      user: this.state.user
    };
    try {
      sessionStorage.setItem('modia_auth', JSON.stringify(authData));
    } catch (err) {
      console.warn('Failed to persist auth state:', err);
    }
  }

  hydrate() {
    try {
      // Check sessionStorage first (current location)
      let saved = sessionStorage.getItem('modia_auth');

      // Migrate from old localStorage if present and sessionStorage empty
      if (!saved) {
        const oldSaved = localStorage.getItem('modia_state');
        if (oldSaved) {
          saved = oldSaved;
          // Migrate to sessionStorage
          sessionStorage.setItem('modia_auth', oldSaved);
          // Clear old localStorage to prevent future conflicts
          localStorage.removeItem('modia_state');
          debugLog('state.logStateChanges', 'Migrated auth tokens from localStorage to sessionStorage');
        }
      }

      if (saved) {
        const { token, refreshToken, user } = JSON.parse(saved);
        this.state.token = token;
        this.state.refreshToken = refreshToken;
        this.state.user = user;
      }
    } catch (err) {
      console.warn('Failed to hydrate auth state:', err);
    }
  }

  clear() {
    this.state.token = null;
    this.state.refreshToken = null;
    this.state.user = null;
    this.state.characters = [];
    this.state.activeCharacter = null;
    try {
      sessionStorage.removeItem('modia_auth');
    } catch (err) {
      console.warn('Failed to clear auth state:', err);
    }
  }
}
