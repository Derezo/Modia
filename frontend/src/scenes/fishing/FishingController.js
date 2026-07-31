import { createFishingActionId } from '../../api/client.js';
import { FishingState } from './FishingState.js';

function attemptIdFrom(state) {
  const attemptId = state.attempt?.attemptId;
  if (!attemptId) throw new Error('The server did not return a fishing attempt');
  return attemptId;
}

export class FishingController {
  constructor({
    api,
    nodeId,
    now,
    onChange = () => {},
    onAnnounce = () => {},
    onError = () => {}
  }) {
    this.api = api;
    this.nodeId = nodeId;
    this.state = new FishingState(now);
    this.onChange = onChange;
    this.onAnnounce = onAnnounce;
    this.onError = onError;
    this.actionIds = new Map();
    this.inFlight = new Map();
    this.castStartPromise = null;
    this.destroyed = false;
  }

  destroy() {
    this.destroyed = true;
    this.inFlight.clear();
    this.actionIds.clear();
  }

  emit(response = null) {
    if (this.destroyed) return;
    const snapshot = response ? this.state.apply(response) : this.state.snapshot();
    this.onChange(snapshot, response);
  }

  async initialize(initialStatus = null) {
    const setup = await this.api.getFishingSetup(this.nodeId);
    if (this.destroyed) return this.state.snapshot();
    this.emit(setup);

    const status = initialStatus?.active || initialStatus?.collectable
      ? initialStatus
      : await this.api.getFishingStatus(this.nodeId);
    if (this.destroyed) return this.state.snapshot();
    if (status?.session) {
      this.emit(status);
      return this.state.snapshot();
    }

    await this.mutate('start', actionId => this.api.startFishing(this.nodeId, actionId));
    if (this.state.settlement && !this.state.active) {
      await this.mutate('start-after-settlement', actionId => (
        this.api.startFishing(this.nodeId, actionId)
      ));
    }
    return this.state.snapshot();
  }

  async refresh() {
    if (this.destroyed) return this.state.snapshot();
    if (this.inFlight.has('status')) return this.inFlight.get('status');
    const request = this.api.getFishingStatus(this.nodeId)
      .then(result => {
        this.emit(result);
        return result;
      })
      .finally(() => this.inFlight.delete('status'));
    this.inFlight.set('status', request);
    return request;
  }

  async mutate(key, operation) {
    if (this.destroyed) return null;
    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const actionId = this.actionIds.get(key) || createFishingActionId();
    this.actionIds.set(key, actionId);
    const request = (async () => {
      try {
        const result = await operation(actionId);
        this.actionIds.delete(key);
        this.emit(result);
        return result;
      } catch (error) {
        if (!error?.isNetworkError && !error?.isTimeout) {
          this.actionIds.delete(key);
        }
        if (!this.destroyed) this.onError(error, { key, actionId });
        throw error;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, request);
    return request;
  }

  selectGear({ rodKey = null, tackleKey = null }) {
    const key = `gear:${rodKey || ''}:${tackleKey || ''}`;
    return this.mutate(key, actionId => (
      this.api.updateFishingGear(
        this.nodeId,
        this.state.sessionId,
        { rodKey, tackleKey },
        actionId
      )
    ));
  }

  beginCast() {
    if (this.castStartPromise) return this.castStartPromise;
    this.state.castVisualStartedAt = this.state.now();
    this.emit();
    this.castStartPromise = this.mutate('cast', actionId => (
      this.api.beginFishingCast(this.nodeId, this.state.sessionId, actionId)
    )).then(result => {
      this.onAnnounce('Cast started. Release at the desired power.');
      return result;
    }).finally(() => {
      this.castStartPromise = null;
    });
    return this.castStartPromise;
  }

  async releaseCast() {
    if (this.castStartPromise) await this.castStartPromise;
    const attemptId = attemptIdFrom(this.state);
    const result = await this.mutate(`release:${attemptId}`, actionId => (
      this.api.releaseFishingCast(
        this.nodeId,
        this.state.sessionId,
        attemptId,
        actionId
      )
    ));
    this.onAnnounce('Line cast. Waiting for a bite.');
    return result;
  }

  async hook() {
    const attemptId = attemptIdFrom(this.state);
    const result = await this.mutate(`hook:${attemptId}`, actionId => (
      this.api.hookFishingCast(
        this.nodeId,
        this.state.sessionId,
        attemptId,
        actionId
      )
    ));
    if (this.state.phase() === 'reel') {
      this.onAnnounce('Fish hooked. Follow the directional tension cues.');
    }
    return result;
  }

  async reel(direction, cueIndex = null) {
    const attemptId = attemptIdFrom(this.state);
    const normalizedDirection = String(direction || '').toLowerCase();
    const key = `reel:${attemptId}:${cueIndex ?? 'current'}:${normalizedDirection}`;
    const result = await this.mutate(key, actionId => (
      this.api.reelFishingCast(
        this.nodeId,
        this.state.sessionId,
        attemptId,
        normalizedDirection,
        cueIndex,
        actionId
      )
    ));
    return result;
  }

  async resolve() {
    const attemptId = attemptIdFrom(this.state);
    const result = await this.mutate(`resolve:${attemptId}`, actionId => (
      this.api.resolveFishingCast(
        this.nodeId,
        this.state.sessionId,
        attemptId,
        actionId
      )
    ));
    const catchRecord = result?.catch || result?.outcome?.catch;
    if (catchRecord) {
      this.onAnnounce(`Caught ${catchRecord.fishName || catchRecord.name || 'a fish'}.`);
    } else {
      this.onAnnounce(result?.message || 'The fish got away.');
    }
    return result;
  }

  end() {
    return this.mutate('end', actionId => (
      this.api.endFishing(this.nodeId, this.state.sessionId, actionId)
    ));
  }
}
