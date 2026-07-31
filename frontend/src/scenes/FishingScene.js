import { Scene } from './Scene.js';
import { responsive } from '../core/Responsive.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { FishingController } from './fishing/FishingController.js';
import { FishingRenderer } from './fishing/FishingRenderer.js';
import { FishingUI } from './fishing/FishingUI.js';
import { ensureFishingStyles } from './fishing/fishingStyles.js';

const DIRECTION_KEYS = {
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowUp: 'up',
  w: 'up',
  W: 'up',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
  ArrowDown: 'down',
  s: 'down',
  S: 'down'
};

function isTypingTarget(target) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName);
}

export class FishingScene extends Scene {
  constructor(game) {
    super(game);
    this.nodeId = null;
    this.nodeName = 'Fishing Spot';
    this.sessionLifecycle = 0;
    this.controller = null;
    this.renderer = null;
    this.ui = null;
    this.uiElement = null;
    this.updateTimer = null;
    this.responsiveUnsubscribe = null;
    this.keyboardAbortController = null;
    this.motionQuery = null;
    this.motionListener = null;
    this.endInFlight = null;
    this.castKeyHeld = false;
    this.lastPhase = 'idle';
    this.lastCatchIdentity = null;
    this.lastTerminalOutcomeIdentity = null;
    this.lastReportedResolveErrorKey = null;
    this.deadlineSyncKey = null;
    this.resolveSync = null;
  }

  enter(data = {}) {
    this.cleanup();
    this.sessionLifecycle += 1;
    const lifecycle = this.sessionLifecycle;
    this.nodeId = data.nodeId;
    this.nodeName = data.nodeName || data.session?.nodeName || 'Fishing Spot';
    this.lastPhase = 'idle';
    this.lastCatchIdentity = null;
    this.lastTerminalOutcomeIdentity = null;
    this.lastReportedResolveErrorKey = null;

    ensureFishingStyles();
    this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.renderer = new FishingRenderer({
      reducedMotion: this.motionQuery?.matches === true
    });
    this.ui = new FishingUI({
      overlay: this.game.uiOverlay,
      nodeName: this.nodeName,
      handlers: {
        onCastStart: () => void this.beginCast(),
        onCastRelease: () => void this.releaseCast(),
        onHook: () => void this.hook(),
        onDirection: (direction, cueIndex) => void this.reel(direction, cueIndex),
        onGear: gear => void this.selectGear(gear),
        onEnd: () => void this.endFishing()
      }
    });
    this.uiElement = this.ui.mount();
    this.controller = new FishingController({
      api: this.game.api,
      nodeId: this.nodeId,
      onChange: (state, response) => this.onStateChange(state, response, lifecycle),
      onAnnounce: message => this.ui?.announce(message),
      onError: (error, action) => this.handleActionError(error, lifecycle, action)
    });
    this.setupKeyboard();
    this.setupMotionPreference();
    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());
    this.updateTimer = setInterval(() => this.refreshTimeState(lifecycle), 100);

    this.game.musicContext?.playNodeMusic('fishing');
    this.game.audio?.playAmbient('fishing_water');
    void this.initialize(lifecycle, data.session || null);
  }

  async initialize(lifecycle, initialStatus) {
    try {
      const restored =
        initialStatus?.active === true ||
        initialStatus?.collectable === true;
      const state = await this.controller.initialize(initialStatus);
      if (!this.ownsLifecycle(lifecycle)) return;
      parchmentToast.success(
        restored ? 'Fishing Restored' : 'Ready to Fish',
        restored
          ? 'Your exact fishing attempt has been restored.'
          : 'Choose your gear and cast when ready.'
      );
      this.ui?.render(state);
    } catch (error) {
      if (!this.ownsLifecycle(lifecycle)) return;
      console.error('Failed to initialize fishing:', error);
      parchmentToast.error('Fishing Unavailable', error.message || 'Failed to prepare this fishing spot');
      this.game.scenes.switchTo('worldMap');
    }
  }

  ownsLifecycle(lifecycle) {
    return lifecycle === this.sessionLifecycle && Boolean(this.controller);
  }

  setupKeyboard() {
    this.keyboardAbortController = new AbortController();
    const options = { signal: this.keyboardAbortController.signal };
    window.addEventListener('keydown', event => {
      if (event.repeat || isTypingTarget(event.target)) return;
      if (
        (event.code === 'Space' || event.key === 'Enter') &&
        this.controller?.state.phase() === 'cast' &&
        !this.castKeyHeld
      ) {
        event.preventDefault();
        void this.releaseCast();
        return;
      }
      if ((event.code === 'Space' || event.key === 'Enter') && this.currentPhaseAllowsCast()) {
        event.preventDefault();
        this.castKeyHeld = true;
        void this.beginCast();
        return;
      }
      const direction = DIRECTION_KEYS[event.key];
      if (direction && this.controller?.state.phase() === 'reel') {
        const cue = this.controller.state.currentCue();
        if (cue) {
          event.preventDefault();
          void this.reel(direction, cue.index);
        }
      }
    }, options);
    window.addEventListener('keyup', event => {
      if (
        this.castKeyHeld &&
        (event.code === 'Space' || event.key === 'Enter')
      ) {
        event.preventDefault();
        this.castKeyHeld = false;
        void this.releaseCast();
      }
    }, options);
  }

  setupMotionPreference() {
    if (!this.motionQuery) return;
    this.motionListener = event => {
      if (this.renderer) this.renderer.reducedMotion = event.matches;
    };
    this.motionQuery.addEventListener?.('change', this.motionListener);
  }

  currentPhaseAllowsCast() {
    return ['idle', 'resolved', 'caught', 'missed', 'failed', 'cancelled'].includes(
      this.controller?.state.phase() || 'idle'
    );
  }

  resolveKeyFor(state) {
    const rawPhase = state?.attempt?.phase;
    if (
      state?.phase !== 'resolve' ||
      !['reel', 'resolve'].includes(rawPhase) ||
      !state.attempt?.attemptId
    ) {
      return null;
    }
    return `${state.attempt.attemptId}:${state.attempt.revision || 0}:resolve`;
  }

  synchronizeResolve(state, lifecycle) {
    if (!this.ownsLifecycle(lifecycle) || this.resolveSync?.reconciling) return;
    const key = this.resolveKeyFor(state);
    if (!key || this.resolveSync?.key === key) return;
    const sync = {
      key,
      lifecycle,
      pending: false,
      reconciling: false,
      reconciled: false,
      ambiguousRetries: 0
    };
    this.resolveSync = sync;
    this.performResolve(sync);
  }

  performResolve(sync) {
    if (
      !this.ownsLifecycle(sync.lifecycle) ||
      this.resolveSync !== sync ||
      sync.pending
    ) {
      return;
    }
    sync.pending = true;
    void this.controller.resolve()
      .then(() => {
        if (this.resolveSync === sync) sync.pending = false;
      })
      .catch(error => {
        if (
          !this.ownsLifecycle(sync.lifecycle) ||
          this.resolveSync !== sync
        ) {
          return;
        }
        sync.pending = false;
        void this.reconcileResolveFailure(sync, error);
      });
  }

  async reconcileResolveFailure(sync, error) {
    if (
      !this.ownsLifecycle(sync.lifecycle) ||
      this.resolveSync !== sync ||
      sync.reconciled
    ) {
      return;
    }
    sync.reconciled = true;
    sync.reconciling = true;
    try {
      await this.controller.refresh();
    } catch {
      // The mutation's common error callback already reported the interruption.
    } finally {
      sync.reconciling = false;
    }
    if (!this.ownsLifecycle(sync.lifecycle) || this.resolveSync !== sync) return;

    const state = this.controller.state.snapshot();
    const currentKey = this.resolveKeyFor(state);
    if (currentKey !== sync.key) {
      this.resolveSync = null;
      this.synchronizeResolve(state, sync.lifecycle);
      return;
    }

    const ambiguous = error?.isNetworkError || error?.isTimeout;
    if (ambiguous && sync.ambiguousRetries < 1) {
      sync.ambiguousRetries += 1;
      this.performResolve(sync);
    }
  }

  refreshTimeState(lifecycle) {
    if (!this.ownsLifecycle(lifecycle)) return;
    const state = this.controller.state.snapshot();
    this.renderer?.setState(state);
    this.ui?.render(state);
    this.handlePhaseTransition(state);
    const rawPhase = state.attempt?.phase;
    const syncKey = `${state.attempt?.attemptId || ''}:${state.attempt?.revision || 0}:${state.phase}`;
    if (
      state.phase === 'missed' &&
      ['wait', 'bite'].includes(rawPhase) &&
      this.deadlineSyncKey !== syncKey
    ) {
      this.deadlineSyncKey = syncKey;
      void this.controller.refresh().catch(error => this.handleActionError(error, lifecycle));
    }
    this.synchronizeResolve(state, lifecycle);
  }

  onStateChange(state, response, lifecycle) {
    if (!this.ownsLifecycle(lifecycle)) return;
    this.renderer?.setState(state);
    this.ui?.render(state);
    this.handlePhaseTransition(state);
    this.synchronizeResolve(state, lifecycle);

    const catchRecord = response?.catch || response?.outcome?.catch || state.attempt?.outcome?.catch;
    const catchIdentity = catchRecord && (
      catchRecord.catchId ||
      `${catchRecord.fishName || catchRecord.name}:${catchRecord.value}:${state.attempt?.attemptId || ''}`
    );
    if (catchRecord && catchIdentity !== this.lastCatchIdentity) {
      this.lastCatchIdentity = catchIdentity;
      this.game.audio?.playInteraction('fishing_catch');
      this.renderer?.triggerSuccess(
        catchRecord.isBigCatch === true ||
        catchRecord.isBigOne === true
      );
      parchmentToast.success(
        catchRecord.isBigCatch || catchRecord.isBigOne ? 'Big Catch Landed!' : 'Catch Landed',
        `${catchRecord.fishName || catchRecord.name || 'Fish'} · ${Number(catchRecord.value) || 0}g`
      );
    }

    const terminalResult = state.terminalResult;
    if (
      terminalResult?.noCatch === true &&
      terminalResult.identity !== this.lastTerminalOutcomeIdentity
    ) {
      this.lastTerminalOutcomeIdentity = terminalResult.identity;
      this.ui?.announce(terminalResult.message);
      parchmentToast.warning(terminalResult.title, terminalResult.message);
    }
  }

  handlePhaseTransition(state) {
    if (state.phase === 'bite' && this.lastPhase !== 'bite') {
      this.game.audio?.playInteraction('fishing_big_one');
      this.ui?.announce('Bite! Hook within three seconds.');
    }
    if (state.phase === 'reel' && this.lastPhase !== 'reel') {
      this.game.audio?.playInteraction('fishing_reel');
    }
    this.lastPhase = state.phase;
  }

  async beginCast() {
    if (!this.controller || !this.currentPhaseAllowsCast()) return;
    try {
      this.game.audio?.playInteraction('fishing_cast');
      await this.controller.beginCast();
    } catch {
      this.castKeyHeld = false;
    }
  }

  async releaseCast() {
    if (!this.controller) return;
    try {
      await this.controller.releaseCast();
    } catch {
      // The controller retains the action ID after ambiguous network failures.
    }
  }

  async hook() {
    if (this.controller?.state.phase() !== 'bite') return;
    try {
      await this.controller.hook();
    } catch {
      // Validation feedback is reported by the common action error handler.
    }
  }

  async reel(direction, cueIndex = null) {
    if (this.controller?.state.phase() !== 'reel') return;
    try {
      await this.controller.reel(direction, cueIndex);
    } catch {
      // Validation feedback is reported by the common action error handler.
    }
  }

  async selectGear(gear) {
    if (!this.controller) return;
    try {
      this.game.audio?.playUI('button_click');
      await this.controller.selectGear(gear);
    } catch {
      // Validation feedback is reported by the common action error handler.
    }
  }

  handleActionError(error, lifecycle, action = null) {
    if (!this.ownsLifecycle(lifecycle)) return;
    const resolveErrorKey = String(action?.key || '').startsWith('resolve:')
      ? action.key
      : null;
    if (
      resolveErrorKey &&
      this.lastReportedResolveErrorKey === resolveErrorKey
    ) {
      return;
    }
    if (resolveErrorKey) {
      this.lastReportedResolveErrorKey = resolveErrorKey;
    }
    const ambiguous = error?.isNetworkError || error?.isTimeout;
    parchmentToast[ambiguous ? 'warning' : 'error'](
      ambiguous ? 'Connection Interrupted' : 'Fishing Action Rejected',
      ambiguous
        ? 'The result is uncertain. Fishing will safely reconcile it; reopen this spot if the prompt remains.'
        : (error.message || 'The fishing state changed. Please follow the current prompt.')
    );
  }

  async endFishing() {
    if (this.endInFlight) return this.endInFlight;
    const lifecycle = this.sessionLifecycle;
    const controller = this.controller;
    if (!controller) return;
    this.game.audio?.playUI('button_click');

    const request = (async () => {
      try {
        const result = await controller.end();
        if (!this.ownsLifecycle(lifecycle) || controller !== this.controller) return result;
        const settlement = result?.settlement || result || {};
        const newGold = Number(
          settlement.newGold ??
          result?.newGold ??
          result?.user?.gold
        );
        if (Number.isFinite(newGold) && this.game.state) {
          this.game.state.set('user', {
            ...this.game.state.get('user'),
            gold: newGold
          });
        }
        const basket = Number(settlement.basketValue ?? controller.state.basket.value) || 0;
        const credited = Number(settlement.creditedGold ?? settlement.goldCredited ?? basket) || 0;
        const overflow = Number(settlement.overflowLost ?? settlement.goldOverflow ?? 0) || 0;
        parchmentToast.success(
          'Fishing Complete',
          `Basket ${basket}g · credited ${credited}g${overflow ? ` · ${overflow}g lost at the gold cap` : ''}`
        );
        this.game.scenes.switchTo('worldMap');
        return result;
      } catch {
        return null;
      }
    })();
    this.endInFlight = request;
    try {
      return await request;
    } finally {
      if (this.endInFlight === request) this.endInFlight = null;
    }
  }

  onBreakpointChange() {
    this.ui?.setMobileTab(this.ui.mobileTab || 'gear');
  }

  cleanup() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this.responsiveUnsubscribe?.();
    this.responsiveUnsubscribe = null;
    this.keyboardAbortController?.abort();
    this.keyboardAbortController = null;
    if (this.motionQuery && this.motionListener) {
      this.motionQuery.removeEventListener?.('change', this.motionListener);
    }
    this.motionQuery = null;
    this.motionListener = null;
    this.controller?.destroy();
    this.controller = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.ui?.destroy();
    this.ui = null;
    this.uiElement = null;
    this.endInFlight = null;
    this.castKeyHeld = false;
    this.deadlineSyncKey = null;
    this.resolveSync = null;
    this.lastTerminalOutcomeIdentity = null;
    this.lastReportedResolveErrorKey = null;
  }

  exit() {
    this.sessionLifecycle += 1;
    this.cleanup();
    this.game.audio?.stopAmbient();
  }

  update(_deltaTime) {}

  render(ctx) {
    this.renderer?.render(
      ctx,
      this.game.targetWidth || 800,
      this.game.targetHeight || 600
    );
  }
}
