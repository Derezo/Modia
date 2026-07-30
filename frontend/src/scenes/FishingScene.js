/**
 * FishingScene - Idle/passive fishing mini-game
 *
 * Players can fish at fishing_spot nodes to earn gold.
 * Auto-catches happen every 20-45 seconds, with occasional
 * "Big One!" events that reward bonus fish if clicked in time.
 */

import { Scene } from './Scene.js';
import { responsive } from '../core/Responsive.js';
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentGradientTextured,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentScrollbarCSS
} from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const P = PARCHMENT_COLORS;

const DEFAULT_FISHING_CONFIG = {
  minCatchInterval: 20000,
  maxCatchInterval: 45000,
  bigOneWindowMs: 5000
};

// Rarity colors for fish display
const RARITY_COLORS = {
  common: '#9e9e9e',
  uncommon: '#1eff00',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000'
};

export class FishingScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;
    this.responsiveUnsubscribe = null;

    // Fishing data
    this.nodeId = null;
    this.nodeName = '';
    this.isActive = false;

    // Session state
    this.sessionId = null;
    this.catches = [];
    this.totalValue = 0;
    this.sessionStartTime = null;
    this.sessionLifecycle = 0;
    this.endInFlight = null;

    // Timers
    this.catchTimer = null;
    this.catchInterval = null;
    this.updateInterval = null;
    this.nextCatchTime = null;

    // Big One state
    this.bigOneActive = false;
    this.bigOneExpires = null;
    this.bigOneFish = null;
    this.bigOneTimer = null;

    // Config from API
    this.config = { ...DEFAULT_FISHING_CONFIG };
  }

  async enter(data = {}) {
    this.stopTimers();
    // A previous collection response may still be in flight if another scene
    // transition re-entered this singleton. Detach it from the new lifecycle;
    // its completion is ownership-checked before it can mutate this scene.
    this.endInFlight = null;
    this.sessionLifecycle += 1;
    const lifecycle = this.sessionLifecycle;
    this.resetLocalSession();

    this.nodeId = data.nodeId;
    this.nodeName = data.nodeName || 'Fishing Spot';

    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setActionButtonsDisabled(true);

    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Play regional fishing music and ambient sounds
    if (this.game.musicContext) {
      this.game.musicContext.playNodeMusic('fishing');
    }
    this.game.audio?.playAmbient('fishing_water');

    // Restore an existing session after refresh, or start a genuinely new one.
    await this.startFishing(lifecycle, data.session);
  }

  exit() {
    this.sessionLifecycle += 1;
    this.isActive = false;
    this.stopTimers();

    // Stop ambient sounds
    this.game.audio?.stopAmbient();

    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  resetLocalSession() {
    this.isActive = false;
    this.sessionId = null;
    this.catches = [];
    this.totalValue = 0;
    this.sessionStartTime = null;
    this.nextCatchTime = null;
    this.bigOneActive = false;
    this.bigOneExpires = null;
    this.bigOneFish = null;
    this.config = { ...DEFAULT_FISHING_CONFIG };
  }

  stopTimers() {
    if (this.catchTimer) {
      clearTimeout(this.catchTimer);
      this.catchTimer = null;
    }
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.bigOneTimer) {
      clearInterval(this.bigOneTimer);
      this.bigOneTimer = null;
    }
  }

  onBreakpointChange() {
    // Rebuild UI for new screen size
    if (this.uiElement) {
      const prevCatches = [...this.catches];
      const prevTotal = this.totalValue;
      const bigOneExpiresIn = this.bigOneActive
        ? Math.max(0, this.bigOneExpires - Date.now())
        : 0;
      const activeBigOne = bigOneExpiresIn > 0 ? {
        ...this.bigOneFish,
        active: true,
        expiresIn: bigOneExpiresIn
      } : null;

      if (this.bigOneTimer) {
        clearInterval(this.bigOneTimer);
        this.bigOneTimer = null;
      }
      if (this.bigOneActive && !activeBigOne) {
        this.bigOneActive = false;
        this.bigOneExpires = null;
        this.bigOneFish = null;
      }

      this.uiElement.remove();
      this.createUI();
      this.setupEventListeners();

      this.catches = prevCatches;
      this.totalValue = prevTotal;
      this.renderCatches();
      this.updateStats();
      this.setActionButtonsDisabled(!this.isActive || Boolean(this.endInFlight));
      if (activeBigOne) {
        this.showBigOne(activeBigOne, false);
      }
    }
  }

  addStyles() {
    if (document.getElementById('fishing-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'fishing-scene-styles';
    style.textContent = `
      .fishing-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: ${getParchmentGradientTextured()};
        display: flex;
        flex-direction: column;
        font-family: Georgia, 'Times New Roman', serif;
        color: ${P.text.primary};
      }

      .fishing-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder(3)};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .fishing-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .fishing-title h2 {
        margin: 0;
        color: ${P.text.primary};
        font-size: 22px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .fishing-status {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        background: linear-gradient(to bottom, ${P.state.success}, #3a5538);
        border-radius: 20px;
        color: #fff;
        font-size: 12px;
        font-weight: bold;
      }

      .fishing-status.inactive {
        background: linear-gradient(to bottom, ${P.text.muted}, #5a5040);
      }

      .fishing-content {
        flex: 1;
        display: flex;
        padding: 20px;
        gap: 20px;
        overflow: hidden;
      }

      @media (max-width: 768px) {
        .fishing-content {
          flex-direction: column;
        }
      }

      .fishing-main-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 24px;
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: 8px;
        box-shadow: ${getParchmentShadow()};
        padding: 24px;
      }

      .fishing-water {
        width: 200px;
        height: 200px;
        border-radius: 50%;
        background: linear-gradient(to bottom, #4a90a4, #2d5a6b);
        border: 4px solid ${P.borderDark};
        box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.3), 0 4px 8px rgba(0, 0, 0, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
      }

      .fishing-water::before {
        content: '';
        position: absolute;
        top: 10%;
        left: 10%;
        width: 80%;
        height: 80%;
        background: linear-gradient(to bottom right, rgba(255,255,255,0.2), transparent);
        border-radius: 50%;
      }

      .fishing-line {
        width: 2px;
        height: 80px;
        background: ${P.text.muted};
        position: absolute;
        top: -80px;
        left: 50%;
        transform: translateX(-50%);
      }

      .fishing-bobber {
        width: 16px;
        height: 16px;
        background: ${P.state.error};
        border-radius: 50%;
        border: 2px solid #fff;
        animation: bobber-float 2s ease-in-out infinite;
      }

      @keyframes bobber-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-8px); }
      }

      .fishing-next-catch {
        text-align: center;
        color: ${P.text.secondary};
        font-size: 14px;
      }

      .fishing-next-catch-time {
        font-size: 24px;
        font-weight: bold;
        color: ${P.text.primary};
      }

      .fishing-big-one {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        z-index: 10;
        animation: big-one-flash 0.5s ease-out;
      }

      @keyframes big-one-flash {
        0%, 50% { background: rgba(255, 215, 0, 0.3); }
        100% { background: rgba(0, 0, 0, 0.8); }
      }

      .fishing-big-one-text {
        font-size: 32px;
        font-weight: bold;
        color: ${P.accent.gold};
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
        animation: big-one-pulse 0.3s ease-in-out infinite alternate;
      }

      @keyframes big-one-pulse {
        0% { transform: scale(1); }
        100% { transform: scale(1.1); }
      }

      .fishing-big-one-fish {
        color: #fff;
        font-size: 18px;
      }

      .fishing-big-one-timer {
        width: 200px;
        height: 8px;
        background: ${P.borderDark};
        border-radius: 4px;
        overflow: hidden;
      }

      .fishing-big-one-timer-bar {
        height: 100%;
        background: linear-gradient(to right, ${P.state.warning}, ${P.state.error});
        transition: width 0.1s linear;
      }

      .fishing-big-one-btn {
        padding: 16px 32px;
        font-size: 20px;
        font-weight: bold;
        font-family: Georgia, serif;
        background: linear-gradient(to bottom, ${P.accent.gold}, #b8860b);
        border: 3px solid #8B6914;
        border-radius: 8px;
        color: #fff;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        cursor: pointer;
        animation: reel-btn-pulse 0.2s ease-in-out infinite alternate;
      }

      @keyframes reel-btn-pulse {
        0% { transform: scale(1); box-shadow: 0 0 10px rgba(255, 215, 0, 0.5); }
        100% { transform: scale(1.05); box-shadow: 0 0 20px rgba(255, 215, 0, 0.8); }
      }

      .fishing-big-one-btn:hover {
        background: linear-gradient(to bottom, #ffd700, ${P.accent.gold});
      }

      .fishing-catches-panel {
        width: 320px;
        display: flex;
        flex-direction: column;
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: 8px;
        box-shadow: ${getParchmentShadow()};
        max-height: 100%;
      }

      @media (max-width: 768px) {
        .fishing-catches-panel {
          width: 100%;
          max-height: 300px;
        }
      }

      .fishing-catches-header {
        padding: 12px 16px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        border-radius: 6px 6px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .fishing-catches-title {
        font-weight: bold;
        color: ${P.text.primary};
      }

      .fishing-catches-total {
        color: ${P.accent.gold};
        font-weight: bold;
      }

      .fishing-catches-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }

      .fishing-catch-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        margin-bottom: 4px;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 1px solid ${P.border};
        border-radius: 6px;
        animation: catch-appear 0.3s ease-out;
      }

      @keyframes catch-appear {
        0% { transform: translateX(-20px); opacity: 0; }
        100% { transform: translateX(0); opacity: 1; }
      }

      .fishing-catch-item.big-one {
        border-color: ${P.accent.gold};
        background: linear-gradient(to bottom, #f5e6c8, #e8d9a8);
        box-shadow: 0 0 8px rgba(255, 215, 0, 0.3);
      }

      .fishing-catch-name {
        font-weight: bold;
      }

      .fishing-catch-value {
        font-weight: bold;
        color: ${P.accent.gold};
      }

      .fishing-catch-badge {
        font-size: 9px;
        padding: 2px 6px;
        border-radius: 3px;
        text-transform: uppercase;
        font-weight: bold;
        margin-left: 6px;
      }

      .fishing-stats {
        display: flex;
        gap: 16px;
        padding: 12px 16px;
        background: linear-gradient(to bottom, ${P.mid}, ${P.light});
        border-top: 1px solid ${P.border};
      }

      .fishing-stat {
        text-align: center;
        flex: 1;
      }

      .fishing-stat-label {
        font-size: 10px;
        color: ${P.text.muted};
        text-transform: uppercase;
      }

      .fishing-stat-value {
        font-size: 16px;
        font-weight: bold;
        color: ${P.text.primary};
      }

      .fishing-actions {
        padding: 16px 24px;
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        border-top: ${getParchmentBorder()};
        display: flex;
        gap: 12px;
      }

      .fishing-btn {
        flex: 1;
        padding: 12px;
        font-size: 14px;
        font-weight: bold;
        font-family: Georgia, serif;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .fishing-btn:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .fishing-btn-primary {
        background: linear-gradient(to bottom, ${P.state.success}, #3a5538);
        border: 2px solid #2a4028;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .fishing-btn-primary:hover {
        background: linear-gradient(to bottom, #5a8058, ${P.state.success});
      }

      .fishing-btn-secondary {
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 2px solid ${P.border};
        color: ${P.text.primary};
      }

      .fishing-btn-secondary:hover {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
      }

      .fishing-empty {
        text-align: center;
        color: ${P.text.muted};
        padding: 24px;
        font-style: italic;
      }

      ${getParchmentScrollbarCSS('.fishing-catches-list')}
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'fishing-container';

    container.innerHTML = `
      <div class="fishing-header">
        <div class="fishing-title">
          <h2>${this.nodeName}</h2>
        </div>
        <div class="fishing-status ${this.isActive ? '' : 'inactive'}" id="fishing-status">
          <span>${this.isActive ? 'Fishing...' : 'Starting...'}</span>
        </div>
      </div>

      <div class="fishing-content">
        <div class="fishing-main-panel" id="main-panel">
          <div class="fishing-water">
            <div class="fishing-line"></div>
            <div class="fishing-bobber"></div>
          </div>
          <div class="fishing-next-catch">
            <div>Next catch in...</div>
            <div class="fishing-next-catch-time" id="next-catch-time">--:--</div>
          </div>
        </div>

        <div class="fishing-catches-panel">
          <div class="fishing-catches-header">
            <span class="fishing-catches-title">Catch Basket</span>
            <span class="fishing-catches-total" id="total-value">0g</span>
          </div>
          <div class="fishing-catches-list" id="catches-list">
            <div class="fishing-empty">No catches yet. Patience!</div>
          </div>
          <div class="fishing-stats">
            <div class="fishing-stat">
              <div class="fishing-stat-label">Catches</div>
              <div class="fishing-stat-value" id="catch-count">0</div>
            </div>
            <div class="fishing-stat">
              <div class="fishing-stat-label">Time</div>
              <div class="fishing-stat-value" id="session-time">0:00</div>
            </div>
          </div>
        </div>
      </div>

      <div class="fishing-actions">
        <button class="fishing-btn fishing-btn-secondary" id="back-btn">Back to Map</button>
        <button class="fishing-btn fishing-btn-primary" id="pack-up-btn">Pack Up & Collect</button>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;
  }

  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    this.uiElement.querySelector('#back-btn')?.addEventListener('click', async () => {
      this.game.audio?.playUI('button_click');
      await this.endFishing();
    }, opts);

    this.uiElement.querySelector('#pack-up-btn')?.addEventListener('click', async () => {
      this.game.audio?.playUI('button_click');
      await this.endFishing();
    }, opts);
  }

  setActionButtonsDisabled(disabled) {
    if (!this.uiElement) return;

    for (const button of this.uiElement.querySelectorAll('.fishing-actions button')) {
      button.disabled = disabled;
    }
  }

  async startFishing(lifecycle = this.sessionLifecycle, initialStatus = null) {
    try {
      const status = initialStatus?.active
        ? initialStatus
        : await this.game.api.getFishingStatus(this.nodeId);
      if (lifecycle !== this.sessionLifecycle) return;

      let result = status;
      let resumed = status.active === true;
      if (!status.active) {
        result = await this.game.api.startFishing(this.nodeId);
        if (lifecycle !== this.sessionLifecycle) return;
        resumed = result.resumed === true;
      }

      this.hydrateSession(result, lifecycle);

      parchmentToast.success(
        resumed ? 'Fishing Restored' : 'Cast Line',
        resumed ? 'Your fishing session has been restored.' : 'Your line is in the water!'
      );
    } catch (err) {
      if (lifecycle !== this.sessionLifecycle) return;

      console.error('Failed to start fishing:', err);
      parchmentToast.error('Error', err.message || 'Failed to start fishing');
      this.game.scenes.switchTo('worldMap');
    }
  }

  hydrateSession(result, lifecycle = this.sessionLifecycle) {
    if (lifecycle !== this.sessionLifecycle) return;

    const session = result.session || result.status || result;
    const sessionId = session.sessionId || result.sessionId;
    if (!sessionId) {
      throw new Error('Fishing session response did not include a session ID');
    }

    this.sessionId = sessionId;
    // The API stores catches oldest-first; the basket displays newest-first.
    this.catches = Array.isArray(session.catches) ? [...session.catches].reverse() : [];
    this.totalValue = Number(session.totalValue ?? session.sessionStats?.totalValue ?? 0);
    this.sessionStartTime = this.normalizeSessionStartTime(session.startTime);
    this.config = {
      ...DEFAULT_FISHING_CONFIG,
      ...(session.config || result.config || {})
    };
    this.isActive = true;

    this.renderCatches();
    this.updateStats();
    this.updateSessionTime();

    const statusEl = this.uiElement?.querySelector('#fishing-status');
    if (statusEl) {
      statusEl.classList.remove('inactive');
      statusEl.innerHTML = '<span>Fishing...</span>';
    }

    this.setActionButtonsDisabled(false);
    this.scheduleCatch();
    this.updateInterval = setInterval(() => {
      this.updateSessionTime();
      this.updateCatchCountdown();
    }, 1000);

    const bigOne = this.normalizeBigOne(session);
    if (bigOne) {
      this.showBigOne(bigOne);
    }
  }

  normalizeSessionStartTime(startTime) {
    const parsed = typeof startTime === 'number' ? startTime : Date.parse(startTime);
    if (!Number.isFinite(parsed)) return Date.now();
    return parsed < 1e12 ? parsed * 1000 : parsed;
  }

  normalizeBigOne(session) {
    if (session.bigOne?.active) {
      return session.bigOne;
    }
    if (!session.bigOneActive || !(session.bigOneExpiresIn > 0)) {
      return null;
    }

    return {
      active: true,
      expiresIn: session.bigOneExpiresIn,
      fishName: session.bigOneFish?.fishName || session.bigOneFish?.name || '',
      rarity: session.bigOneFish?.rarity || ''
    };
  }

  scheduleCatch() {
    if (!this.isActive || this.endInFlight) return;

    // Random interval between min and max
    const interval = this.config.minCatchInterval +
      (Math.random() * (this.config.maxCatchInterval - this.config.minCatchInterval));

    this.nextCatchTime = Date.now() + interval;

    this.catchTimer = setTimeout(async () => {
      await this.triggerCatch();
    }, interval);
  }

  async triggerCatch() {
    if (!this.isActive || this.endInFlight || !this.sessionId) return;

    const lifecycle = this.sessionLifecycle;
    const sessionId = this.sessionId;

    try {
      const result = await this.game.api.registerCatch(this.nodeId, sessionId);
      if (
        !this.isActive ||
        this.endInFlight ||
        lifecycle !== this.sessionLifecycle ||
        sessionId !== this.sessionId
      ) {
        return;
      }

      // Play fish catch sound
      this.game.audio?.playInteraction('fishing_catch');

      // Add catch to list
      this.catches.unshift(result.catch);
      this.totalValue = result.sessionStats.totalValue;
      this.renderCatches();
      this.updateStats();

      // Check for Big One event
      if (result.bigOne?.active) {
        this.showBigOne(result.bigOne);
      }

      // Schedule next catch
      this.scheduleCatch();

    } catch (err) {
      if (
        !this.isActive ||
        this.endInFlight ||
        lifecycle !== this.sessionLifecycle ||
        sessionId !== this.sessionId
      ) {
        return;
      }

      console.error('Failed to register catch:', err);
      // Session may have expired
      if (err.message?.includes('expired')) {
        parchmentToast.warning('Session Expired', 'Your fishing session has ended.');
        await this.endFishing();
        return;
      }

      // Try again
      this.scheduleCatch();
    }
  }

  showBigOne(bigOneData, playSound = true) {
    if (!this.isActive || this.endInFlight) return;

    this.bigOneActive = true;
    this.bigOneFish = bigOneData;
    this.bigOneExpires = Date.now() + bigOneData.expiresIn;

    // Play big one alert sound
    if (playSound) {
      this.game.audio?.playInteraction('fishing_big_one');
    }

    const mainPanel = this.uiElement.querySelector('#main-panel');
    if (!mainPanel) return;

    // Create big one overlay
    const overlay = document.createElement('div');
    overlay.className = 'fishing-big-one';
    overlay.id = 'big-one-overlay';
    overlay.innerHTML = `
      <div class="fishing-big-one-text">BIG ONE!</div>
      <div class="fishing-big-one-fish">${bigOneData.fishName} (${bigOneData.rarity})</div>
      <div class="fishing-big-one-timer">
        <div class="fishing-big-one-timer-bar" id="big-one-timer-bar" style="width: 100%"></div>
      </div>
      <button class="fishing-big-one-btn" id="reel-btn">REEL HARD!</button>
    `;

    mainPanel.style.position = 'relative';
    mainPanel.appendChild(overlay);

    // Add click handler
    overlay.querySelector('#reel-btn')?.addEventListener('click', () => {
      this.claimBigOne();
    });

    // Start countdown timer
    this.bigOneTimer = setInterval(() => {
      this.updateBigOneTimer();
    }, 100);
  }

  updateBigOneTimer() {
    if (!this.bigOneActive) return;

    const remaining = Math.max(0, this.bigOneExpires - Date.now());
    const percent = (remaining / this.config.bigOneWindowMs) * 100;

    const timerBar = this.uiElement.querySelector('#big-one-timer-bar');
    if (timerBar) {
      timerBar.style.width = `${percent}%`;
    }

    if (remaining <= 0) {
      this.hideBigOne(false);
    }
  }

  async claimBigOne() {
    if (!this.bigOneActive || !this.isActive || this.endInFlight || !this.sessionId) return;

    const lifecycle = this.sessionLifecycle;
    const sessionId = this.sessionId;

    try {
      const result = await this.game.api.claimBigOne(this.nodeId, sessionId);
      if (
        !this.isActive ||
        this.endInFlight ||
        lifecycle !== this.sessionLifecycle ||
        sessionId !== this.sessionId
      ) {
        return;
      }

      // Add big one catch
      this.catches.unshift(result.catch);
      this.totalValue = result.sessionStats.totalValue;
      this.renderCatches();
      this.updateStats();

      parchmentToast.success('Big One!', result.message);
      this.hideBigOne(true);

    } catch (err) {
      if (
        !this.isActive ||
        this.endInFlight ||
        lifecycle !== this.sessionLifecycle ||
        sessionId !== this.sessionId
      ) {
        return;
      }

      console.error('Failed to claim big one:', err);
      parchmentToast.warning('Too Slow!', err.message);
      this.hideBigOne(false);
    }
  }

  hideBigOne(success) {
    this.bigOneActive = false;

    if (this.bigOneTimer) {
      clearInterval(this.bigOneTimer);
      this.bigOneTimer = null;
    }

    const overlay = this.uiElement.querySelector('#big-one-overlay');
    if (overlay) {
      overlay.remove();
    }

    if (!success) {
      parchmentToast.info('Got Away', 'The big one escaped!');
    }
  }

  renderCatches() {
    const listEl = this.uiElement.querySelector('#catches-list');
    if (!listEl) return;

    if (this.catches.length === 0) {
      listEl.innerHTML = '<div class="fishing-empty">No catches yet. Patience!</div>';
      return;
    }

    listEl.innerHTML = this.catches.slice(0, 20).map(c => `
      <div class="fishing-catch-item ${c.isBigOne ? 'big-one' : ''}">
        <span>
          <span class="fishing-catch-name" style="color: ${RARITY_COLORS[c.rarity] || RARITY_COLORS.common}">
            ${escapeHtml(c.fishName || '')}
          </span>
          ${c.isBigOne ? '<span class="fishing-catch-badge" style="background: gold; color: #333;">BIG ONE</span>' : ''}
        </span>
        <span class="fishing-catch-value">${c.value}g</span>
      </div>
    `).join('');
  }

  updateStats() {
    const totalEl = this.uiElement.querySelector('#total-value');
    const countEl = this.uiElement.querySelector('#catch-count');

    if (totalEl) totalEl.textContent = `${this.totalValue}g`;
    if (countEl) countEl.textContent = this.catches.length;
  }

  updateSessionTime() {
    const timeEl = this.uiElement.querySelector('#session-time');
    if (!timeEl || !this.sessionStartTime) return;

    const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    timeEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  updateCatchCountdown() {
    const countdownEl = this.uiElement.querySelector('#next-catch-time');
    if (!countdownEl || !this.nextCatchTime) return;

    const remaining = Math.max(0, this.nextCatchTime - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    countdownEl.textContent = `~${seconds}s`;
  }

  async endFishing() {
    if (this.endInFlight) return this.endInFlight;

    const request = this.finishFishing();
    this.endInFlight = request;

    try {
      return await request;
    } finally {
      if (this.endInFlight === request) {
        this.endInFlight = null;
      }
    }
  }

  async finishFishing() {
    const nodeId = this.nodeId;
    const sessionId = this.sessionId;

    this.isActive = false;
    this.sessionLifecycle += 1;
    const lifecycle = this.sessionLifecycle;
    this.stopTimers();
    this.setActionButtonsDisabled(true);
    let shouldReturnToMap = false;

    try {
      if (!sessionId) {
        shouldReturnToMap = lifecycle === this.sessionLifecycle;
        return;
      }

      const result = await this.game.api.endFishing(nodeId, sessionId);
      if (
        lifecycle !== this.sessionLifecycle ||
        sessionId !== this.sessionId
      ) {
        return result;
      }

      // Update player gold
      this.game.state.set('user', {
        ...this.game.state.get('user'),
        gold: result.newGold
      });

      parchmentToast.success('Session Complete', result.message);
      this.resetLocalSession();
      shouldReturnToMap = true;

    } catch (err) {
      console.error('Failed to end fishing:', err);
      shouldReturnToMap = (
        lifecycle === this.sessionLifecycle &&
        sessionId === this.sessionId
      );
    } finally {
      if (shouldReturnToMap) {
        this.game.scenes.switchTo('worldMap');
      }
    }
  }

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // Draw water background
    const gradient = ctx.createLinearGradient(0, 0, 0, this.game.targetHeight);
    gradient.addColorStop(0, '#4a90a4');
    gradient.addColorStop(0.5, '#3d7a8c');
    gradient.addColorStop(1, '#2d5a6b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);
  }
}
