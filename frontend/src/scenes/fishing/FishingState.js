const TERMINAL_PHASES = new Set([
  'resolved',
  'caught',
  'missed',
  'failed',
  'expired',
  'cancelled'
]);

const ACTIVE_ATTEMPT_PHASES = new Set([
  'cast',
  'wait',
  'bite',
  'reel',
  'resolve'
]);

function epoch(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePhase(phase) {
  const value = String(phase || 'idle').toLowerCase().replaceAll('-', '_');
  return {
    casting: 'cast',
    waiting: 'wait',
    biting: 'bite',
    hooking: 'bite',
    reeling: 'reel',
    ready_to_resolve: 'resolve'
  }[value] || value;
}

function normalizeBasket(session = {}) {
  const basket = session.basket || session.sessionBasket || {};
  const catches = basket.catches || session.catches || [];
  return {
    catches: Array.isArray(catches) ? catches.map(catchRecord => ({ ...catchRecord })) : [],
    value: Number(
      basket.value ??
      basket.totalValue ??
      session.basketValue ??
      session.totalValue ??
      session.sessionStats?.totalValue ??
      0
    ) || 0
  };
}

function normalizeOwnedTackle(value) {
  if (Array.isArray(value)) return value.map(item => ({ ...item }));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([catalogKey, item]) => (
    typeof item === 'number'
      ? { catalogKey, count: item }
      : { catalogKey, ...item }
  ));
}

function normalizeAttempt(attempt) {
  if (!attempt?.attemptId) return null;
  const timestamps = attempt.timestamps || {};
  const reel = attempt.reel || {};
  const cueSource = attempt.cues ?? reel.cues;
  const cues = Array.isArray(cueSource)
    ? cueSource.map((cue, index) => (
      typeof cue === 'string'
        ? { index, direction: cue }
        : { index, ...cue }
    ))
    : [];

  return {
    ...attempt,
    attemptId: attempt.attemptId,
    revision: Number(attempt.revision) || 0,
    phase: normalizePhase(attempt.phase),
    timestamps: {
      ...timestamps,
      castStartedAt: epoch(timestamps.castStartedAt ?? attempt.castStartedAt),
      releasedAt: epoch(timestamps.releasedAt ?? attempt.releasedAt),
      biteAt: epoch(timestamps.biteAt ?? attempt.biteAt),
      hookDeadline: epoch(
        timestamps.hookDeadline ??
        timestamps.hookExpiresAt ??
        attempt.hookDeadline ??
        attempt.hookExpiresAt
      ),
      reelStartedAt: epoch(timestamps.reelStartedAt ?? attempt.reelStartedAt),
      reelDeadline: epoch(
        timestamps.reelDeadline ??
        timestamps.reelExpiresAt ??
        attempt.reelDeadline ??
        attempt.reelExpiresAt
      ),
      resolvesAt: epoch(timestamps.resolvesAt ?? attempt.resolvesAt)
    },
    cues,
    requiredHits: Number(attempt.requiredHits ?? reel.requiredHits) || 0,
    cueDurationMs: Number(attempt.cueDurationMs ?? reel.cueWindowMs) || 0,
    totalDurationMs: Number(attempt.totalDurationMs ?? reel.totalDurationMs) || 0,
    nextCueIndex: Number(attempt.nextCueIndex ?? reel.nextCueIndex) || 0,
    hits: Number(attempt.hits ?? attempt.successfulHits ?? reel.hits) || 0,
    misses: Number(attempt.misses ?? reel.misses) || 0,
    reelStartedAt: epoch(attempt.reelStartedAt ?? reel.startedAt),
    outcome: attempt.outcome || null
  };
}

function cleanMessage(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureSentence(message) {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

function noCatchMessage(message, detail) {
  const base = cleanMessage(message);
  return `${base ? `${ensureSentence(base)} ` : ''}${detail}`;
}

function terminalResultFor(attempt, response = {}) {
  if (!attempt || !TERMINAL_PHASES.has(attempt.phase)) return null;
  const outcome = attempt.outcome || response.outcome || {};
  const result = String(
    outcome.result ||
    ({
      caught: 'caught',
      missed: 'missed_hook',
      failed: 'reel_failed',
      cancelled: 'cancelled'
    }[attempt.phase] || attempt.phase)
  ).toLowerCase();
  const serverMessage = cleanMessage(response.message);
  const catchRecord = outcome.catch || response.catch || null;
  const identity = `${attempt.attemptId}:${result}`;

  if (result === 'caught' || catchRecord) {
    const fishName = catchRecord?.fishName || catchRecord?.name || 'Fish';
    const isBigCatch = outcome.isBigCatch === true ||
      catchRecord?.isBigCatch === true ||
      catchRecord?.isBigOne === true;
    return {
      identity,
      kind: 'caught',
      title: isBigCatch ? 'Big Catch Landed!' : 'Catch Landed',
      message: serverMessage || `${fishName} was added to your basket.`,
      noCatch: false
    };
  }

  if (result === 'big_catch_escaped') {
    return {
      identity,
      kind: result,
      title: 'Big Catch Escaped',
      message: serverMessage
        ? `${ensureSentence(serverMessage)} No fish was added to your basket.`
        : 'The Big Catch broke free. No fish was added to your basket; Big Catches do not award a fallback fish.',
      noCatch: true
    };
  }

  if (result === 'reel_failed') {
    return {
      identity,
      kind: result,
      title: 'Fish Escaped',
      message: noCatchMessage(
        serverMessage || 'The fish escaped during the reel',
        'No fish was added to your basket.'
      ),
      noCatch: true
    };
  }

  if (result === 'missed_hook') {
    return {
      identity,
      kind: result,
      title: 'Hook Missed',
      message: noCatchMessage(
        serverMessage || 'The hook window was missed',
        'No fish was added to your basket.'
      ),
      noCatch: true
    };
  }

  if (result === 'session_expiring') {
    return {
      identity,
      kind: result,
      title: 'Not Enough Time',
      message: serverMessage ||
        'There is not enough session time left for another cast. No tackle was consumed.',
      noCatch: true
    };
  }

  if (result === 'packed_up' || result === 'cancelled') {
    return {
      identity,
      kind: result,
      title: 'Cast Cancelled',
      message: serverMessage ||
        'The unfinished cast was cancelled. Already-used tackle was not refunded.',
      noCatch: true
    };
  }

  return {
    identity,
    kind: result,
    title: 'Fishing Result',
    message: serverMessage || 'The attempt ended without adding a fish to your basket.',
    noCatch: outcome.awarded !== true
  };
}

function defaultBackgroundPath(biome) {
  const key = String(
    typeof biome === 'string'
      ? biome
      : biome?.key || biome?.name || ''
  ).toLowerCase().replaceAll(' ', '_');
  return [
    'heartlands',
    'sylvan_reaches',
    'iron_depths',
    'shadowmere',
    'bloodplains'
  ].includes(key)
    ? `/assets/fishing/backgrounds/${key}.webp`
    : null;
}

export class FishingState {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.reset();
  }

  reset() {
    this.active = false;
    this.nodeId = null;
    this.nodeName = 'Fishing Spot';
    this.biome = null;
    this.backgroundPath = null;
    this.session = null;
    this.sessionId = null;
    this.sessionStartTime = null;
    this.sessionEndsAt = null;
    this.selectedRod = null;
    this.selectedTackle = null;
    this.ownedRods = [];
    this.ownedTackle = [];
    this.publicFish = [];
    this.basket = { catches: [], value: 0 };
    this.attempt = null;
    this.settlement = null;
    this.serverOffsetMs = 0;
    this.castVisualStartedAt = null;
    this.lastResult = null;
    this.terminalResult = null;
  }

  apply(response = {}) {
    if (response.serverTime !== undefined) {
      const serverTime = epoch(response.serverTime);
      if (serverTime !== null) {
        this.serverOffsetMs = serverTime - this.now();
      }
    }

    const explicitlyNoSession = (
      Object.prototype.hasOwnProperty.call(response, 'session') &&
      response.session === null
    );
    if (explicitlyNoSession) {
      this.session = null;
      this.sessionId = null;
      this.sessionStartTime = null;
      this.sessionEndsAt = null;
      this.active = false;
      this.attempt = null;
      this.basket = normalizeBasket(response.basket || {});
      this.lastResult = null;
      this.terminalResult = null;
    }

    const session = explicitlyNoSession
      ? null
      : response.session || response.status || (
        response.sessionId ? response : this.session
      );
    if (session) {
      this.session = { ...(this.session || {}), ...session };
      this.sessionId = session.sessionId ?? this.sessionId;
      this.nodeId = session.nodeId ?? response.nodeId ?? this.nodeId;
      this.nodeName = session.nodeName ?? response.nodeName ?? this.nodeName;
      this.sessionStartTime = epoch(session.startedAt ?? session.startTime) ?? this.sessionStartTime;
      this.sessionEndsAt = epoch(
        session.expiresAt ??
        session.endsAt ??
        session.endTime
      ) ?? this.sessionEndsAt;
      this.basket = normalizeBasket(this.session);
      this.active = (
        session.active ??
        (session.status !== undefined ? session.status === 'active' : undefined) ??
        response.active ??
        this.active
      );
    } else if (response.active !== undefined) {
      this.active = response.active === true;
    }

    this.nodeId = response.nodeId ?? this.nodeId;
    this.nodeName = response.nodeName ?? this.nodeName;
    this.biome = response.biome ?? response.regionRace ?? this.biome;
    this.backgroundPath = (
      response.backgroundPath ??
      response.biomeBackgroundPath ??
      response.biome?.backgroundPath ??
      defaultBackgroundPath(this.biome) ??
      this.backgroundPath
    );
    if (Object.prototype.hasOwnProperty.call(response, 'selectedRod')) {
      this.selectedRod = response.selectedRod;
    } else {
      this.selectedRod = this.session?.selectedRod ?? this.selectedRod;
    }
    if (Object.prototype.hasOwnProperty.call(response, 'selectedTackle')) {
      this.selectedTackle = response.selectedTackle;
    } else {
      this.selectedTackle = this.session?.selectedTackle ?? this.selectedTackle;
    }
    const ownedRods = response.ownedRods ?? response.rods ?? response.availableRods;
    this.ownedRods = Array.isArray(ownedRods) ? [...ownedRods] : this.ownedRods;
    if (response.ownedTackle !== undefined) {
      this.ownedTackle = normalizeOwnedTackle(response.ownedTackle);
    }
    this.publicFish = Array.isArray(response.publicFish)
      ? response.publicFish.map(fish => ({ ...fish }))
      : this.publicFish;

    if (Object.prototype.hasOwnProperty.call(response, 'attempt')) {
      this.attempt = normalizeAttempt(response.attempt);
      if (this.attempt?.phase !== 'cast') this.castVisualStartedAt = null;
      if (!this.attempt || ACTIVE_ATTEMPT_PHASES.has(this.attempt.phase)) {
        this.lastResult = null;
        this.terminalResult = null;
      } else {
        const terminalResult = terminalResultFor(this.attempt, response);
        if (
          terminalResult &&
          (
            terminalResult.identity !== this.terminalResult?.identity ||
            cleanMessage(response.message)
          )
        ) {
          this.terminalResult = terminalResult;
        }
      }
    }
    if (response.settlement) this.settlement = { ...response.settlement };
    if (response.catch || response.outcome || this.attempt?.outcome) {
      this.lastResult = response.catch || response.outcome || this.attempt?.outcome;
    }
    return this.snapshot();
  }

  serverNow() {
    return this.now() + this.serverOffsetMs;
  }

  phase() {
    const phase = this.attempt?.phase || 'idle';
    const now = this.serverNow();
    if (
      phase === 'wait' &&
      this.attempt.timestamps.biteAt !== null &&
      now >= this.attempt.timestamps.biteAt
    ) {
      return (
        this.attempt.timestamps.hookDeadline !== null &&
        now > this.attempt.timestamps.hookDeadline
      ) ? 'missed' : 'bite';
    }
    if (
      phase === 'bite' &&
      this.attempt.timestamps.hookDeadline !== null &&
      now > this.attempt.timestamps.hookDeadline
    ) {
      return 'missed';
    }
    if (
      phase === 'reel' &&
      this.attempt.timestamps.reelDeadline !== null &&
      now > this.attempt.timestamps.reelDeadline
    ) {
      return 'resolve';
    }
    return phase;
  }

  isTerminalAttempt() {
    return Boolean(this.attempt && TERMINAL_PHASES.has(this.attempt.phase));
  }

  deadline() {
    if (!this.attempt) return null;
    const phase = this.phase();
    if (phase === 'bite') return this.attempt.timestamps.hookDeadline;
    if (phase === 'reel') return this.attempt.timestamps.reelDeadline;
    if (phase === 'wait') {
      return this.attempt.timestamps.biteAt ?? this.attempt.timestamps.resolvesAt;
    }
    return null;
  }

  remainingMs(deadline = this.deadline()) {
    return deadline === null ? null : Math.max(0, deadline - this.serverNow());
  }

  currentCue() {
    if (this.phase() !== 'reel') return null;
    const now = this.serverNow();
    const timed = this.attempt.cues.find(cue => {
      const startsAt = epoch(cue.startsAt ?? cue.startAt);
      const endsAt = epoch(cue.endsAt ?? cue.endAt);
      return startsAt !== null && endsAt !== null && now >= startsAt && now <= endsAt;
    });
    if (timed) return timed;
    const elapsedIndex = (
      this.attempt.reelStartedAt !== null &&
      this.attempt.cueDurationMs > 0
    ) ? Math.floor((now - this.attempt.reelStartedAt) / this.attempt.cueDurationMs) : null;
    const nextCueIndex = Number(this.attempt.nextCueIndex ?? 0);
    if (elapsedIndex !== null && elapsedIndex < nextCueIndex) {
      return null;
    }
    const index = Math.min(
      elapsedIndex === null
        ? Number(this.attempt.nextCueIndex ?? this.attempt.cueIndex ?? 0)
        : Math.max(0, elapsedIndex),
      Math.max(0, this.attempt.cues.length - 1)
    );
    return this.attempt.cues[index] || null;
  }

  snapshot() {
    const currentCue = this.currentCue();
    const cueDeadline = (
      currentCue &&
      this.attempt?.reelStartedAt !== null &&
      this.attempt?.cueDurationMs > 0
    ) ? (
        this.attempt.reelStartedAt +
        ((currentCue.index + 1) * this.attempt.cueDurationMs)
      ) : null;
    return {
      active: this.active,
      nodeId: this.nodeId,
      nodeName: this.nodeName,
      biome: this.biome,
      backgroundPath: this.backgroundPath,
      session: this.session,
      sessionId: this.sessionId,
      sessionStartTime: this.sessionStartTime,
      sessionEndsAt: this.sessionEndsAt,
      selectedRod: this.selectedRod,
      selectedTackle: this.selectedTackle,
      ownedRods: this.ownedRods,
      ownedTackle: this.ownedTackle,
      publicFish: this.publicFish,
      basket: this.basket,
      attempt: this.attempt,
      settlement: this.settlement,
      phase: this.phase(),
      currentCueIndex: currentCue?.index ?? null,
      cueRemainingMs: cueDeadline === null
        ? null
        : Math.max(0, cueDeadline - this.serverNow()),
      serverNow: this.serverNow(),
      remainingMs: this.remainingMs(),
      castVisualStartedAt: this.castVisualStartedAt,
      lastResult: this.lastResult,
      terminalResult: this.terminalResult,
      resultMessage: this.terminalResult?.message || null
    };
  }
}
