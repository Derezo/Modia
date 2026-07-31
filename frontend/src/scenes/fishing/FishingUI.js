import {
  escapeHtml,
  escapeHtmlAttribute
} from '../../utils/escapeHtml.js';
import { ItemIcon } from '../../components/ItemIcon.js';

const DIRECTIONS = {
  left: ['←', 'Left'],
  up: ['↑', 'Up'],
  right: ['→', 'Right'],
  down: ['↓', 'Down']
};

function itemKey(item) {
  return String(item?.catalogKey ?? item?.key ?? item?.itemKey ?? item?.id ?? item ?? '');
}

function itemName(item) {
  return String(item?.name ?? item?.displayName ?? itemKey(item));
}

function selectedKey(item) {
  return itemKey(item);
}

function formatTime(milliseconds) {
  const total = Math.max(0, Math.ceil((milliseconds || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export class FishingUI {
  constructor({ overlay, nodeName, handlers = {} }) {
    this.overlay = overlay;
    this.nodeName = nodeName;
    this.handlers = handlers;
    this.root = null;
    this.abortController = null;
    this.mobileTab = 'gear';
    this.gearSignature = '';
    this.catalogSignature = '';
    this.basketSignature = '';
  }

  mount() {
    const root = document.createElement('div');
    root.className = 'fishing-shell';
    root.innerHTML = `
      <header class="fishing-header">
        <h2>${escapeHtml(this.nodeName || 'Fishing Spot')}</h2>
        <div class="fishing-session-summary">
          <span id="fishing-basket-header" class="fishing-basket-value">0g</span>
          <span id="fishing-session-time">30:00</span>
          <span id="fishing-phase" class="fishing-phase">Preparing</span>
        </div>
      </header>
      <main class="fishing-layout">
        <aside class="fishing-panel fishing-gear-panel mobile-active" data-mobile-panel="gear">
          <h3>Gear</h3>
          <label class="fishing-field">Rod
            <select id="fishing-rod-select" aria-label="Fishing rod"></select>
          </label>
          <label class="fishing-field">Tackle for next cast
            <select id="fishing-tackle-select" aria-label="Fishing tackle"></select>
          </label>
          <div class="fishing-gear-preview" aria-label="Selected fishing gear">
            <span id="fishing-rod-icon"></span>
            <span id="fishing-tackle-icon"></span>
          </div>
          <p id="fishing-rod-rate"></p>
        </aside>
        <section class="fishing-pond-panel" id="fishing-pond" aria-label="Fishing pond">
          <div class="fishing-controls">
            <p id="fishing-instruction" class="fishing-instruction">Preparing the pond…</p>
            <div id="fishing-result" class="fishing-result" role="status" aria-live="polite"
              aria-atomic="true" hidden>
              <strong id="fishing-result-title"></strong>
              <span id="fishing-result-message"></span>
            </div>
            <div class="fishing-power-track" aria-label="Cast power">
              <div id="fishing-power-fill" class="fishing-power-fill"></div>
            </div>
            <div class="fishing-countdown-track" aria-hidden="true">
              <div id="fishing-countdown-fill" class="fishing-countdown-fill"></div>
            </div>
            <button id="fishing-cast-button" class="fishing-primary" type="button">Hold to Cast</button>
            <button id="fishing-hook-button" class="fishing-primary" type="button" hidden>HOOK!</button>
            <div id="fishing-cues" class="fishing-cues" hidden></div>
          </div>
          <div id="fishing-live" class="fishing-live" aria-live="assertive" aria-atomic="true"></div>
        </section>
        <div class="fishing-side-panels">
          <aside class="fishing-panel fishing-catalog-panel" data-mobile-panel="fish">
            <h3>Fish in These Waters</h3>
            <ul id="fishing-catalog" class="fishing-list"></ul>
          </aside>
          <aside class="fishing-panel fishing-basket-panel" data-mobile-panel="basket">
            <h3>Basket <span id="fishing-basket-value" class="fishing-basket-value">0g</span></h3>
            <ul id="fishing-basket" class="fishing-list"></ul>
            <div id="fishing-settlement"></div>
          </aside>
        </div>
        <nav class="fishing-mobile-tabs" aria-label="Fishing panels">
          <button class="fishing-tab" data-tab="gear" type="button">Gear</button>
          <button class="fishing-tab" data-tab="fish" type="button">Fish</button>
          <button class="fishing-tab" data-tab="basket" type="button">Basket</button>
        </nav>
      </main>
      <footer class="fishing-footer">
        <button id="fishing-back-button" class="fishing-secondary" type="button">Back to Map</button>
        <button id="fishing-pack-button" class="fishing-primary" type="button">Pack Up & Collect</button>
      </footer>
    `;
    this.overlay.appendChild(root);
    this.root = root;
    this.bind();
    this.setMobileTab(this.mobileTab);
    return root;
  }

  bind() {
    this.abortController = new AbortController();
    const options = { signal: this.abortController.signal };
    const castButton = this.root.querySelector('#fishing-cast-button');
    let pressed = false;
    const begin = event => {
      if (castButton.disabled || pressed) return;
      if (castButton.dataset?.mode === 'release') {
        event.preventDefault();
        this.handlers.onCastRelease?.();
        return;
      }
      pressed = true;
      event.preventDefault();
      castButton.setPointerCapture?.(event.pointerId);
      this.handlers.onCastStart?.();
    };
    const release = event => {
      if (!pressed) return;
      pressed = false;
      event.preventDefault();
      this.handlers.onCastRelease?.();
    };
    castButton.addEventListener('pointerdown', begin, options);
    castButton.addEventListener('pointerup', release, options);
    castButton.addEventListener('pointercancel', release, options);
    castButton.addEventListener('lostpointercapture', release, options);
    this.root.querySelector('#fishing-hook-button').addEventListener(
      'click',
      () => this.handlers.onHook?.(),
      options
    );
    this.root.querySelector('#fishing-cues').addEventListener('click', event => {
      const button = event.target.closest?.('[data-direction]');
      if (button) this.handlers.onDirection?.(button.dataset.direction, Number(button.dataset.cueIndex));
    }, options);
    this.root.querySelector('#fishing-rod-select').addEventListener(
      'change',
      event => this.handlers.onGear?.({
        rodKey: event.target.value || null,
        tackleKey: this.root.querySelector('#fishing-tackle-select').value || null
      }),
      options
    );
    this.root.querySelector('#fishing-tackle-select').addEventListener(
      'change',
      event => this.handlers.onGear?.({
        rodKey: this.root.querySelector('#fishing-rod-select').value || null,
        tackleKey: event.target.value || null
      }),
      options
    );
    this.root.querySelector('#fishing-pack-button').addEventListener(
      'click',
      () => this.handlers.onEnd?.(),
      options
    );
    this.root.querySelector('#fishing-back-button').addEventListener(
      'click',
      () => this.handlers.onEnd?.(),
      options
    );
    for (const tab of this.root.querySelectorAll('[data-tab]')) {
      tab.addEventListener('click', () => this.setMobileTab(tab.dataset.tab), options);
    }
  }

  setMobileTab(tab) {
    this.mobileTab = tab;
    for (const panel of this.root.querySelectorAll('[data-mobile-panel]')) {
      panel.classList.toggle('mobile-active', panel.dataset.mobilePanel === tab);
    }
    for (const button of this.root.querySelectorAll('[data-tab]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    }
  }

  announce(message) {
    const live = this.root?.querySelector('#fishing-live');
    if (live) live.textContent = message;
  }

  renderGear(state) {
    const signature = JSON.stringify([
      state.ownedRods,
      state.ownedTackle,
      selectedKey(state.selectedRod),
      selectedKey(state.selectedTackle)
    ]);
    if (signature === this.gearSignature) return;
    this.gearSignature = signature;
    const rodSelect = this.root.querySelector('#fishing-rod-select');
    const rods = state.ownedRods || [];
    rodSelect.innerHTML = rods.length
      ? rods.map(rod => {
        const key = itemKey(rod);
        return `<option value="${escapeHtmlAttribute(key)}">${escapeHtml(itemName(rod))}</option>`;
      }).join('')
      : '<option value="">No rod owned</option>';
    rodSelect.value = selectedKey(state.selectedRod);

    const tackleSelect = this.root.querySelector('#fishing-tackle-select');
    tackleSelect.innerHTML = '<option value="">No tackle</option>' + (state.ownedTackle || []).map(tackle => {
      const key = itemKey(tackle);
      const count = Number(tackle.count ?? tackle.quantity ?? 0);
      return `<option value="${escapeHtmlAttribute(key)}" ${count <= 0 ? 'disabled' : ''}>${escapeHtml(itemName(tackle))} (${count})</option>`;
    }).join('');
    tackleSelect.value = selectedKey(state.selectedTackle);
    this.root.querySelector('#fishing-rod-icon').innerHTML = state.selectedRod?.spriteId
      ? ItemIcon.html({
        item: state.selectedRod,
        itemType: 'key_item',
        size: 'lg',
        title: itemName(state.selectedRod)
      })
      : '';
    this.root.querySelector('#fishing-tackle-icon').innerHTML = state.selectedTackle?.spriteId
      ? ItemIcon.html({
        item: state.selectedTackle,
        itemType: 'material',
        size: 'lg',
        title: itemName(state.selectedTackle)
      })
      : '';
    const rate = Number(state.selectedRod?.bigCatchRate ?? state.selectedRod?.landingRate);
    this.root.querySelector('#fishing-rod-rate').textContent = Number.isFinite(rate)
      ? `Big Catch landing rate: ${rate <= 1 ? rate * 100 : rate}% absolute`
      : '';
  }

  renderCatalog(state) {
    const signature = JSON.stringify(state.publicFish);
    if (signature === this.catalogSignature) return;
    this.catalogSignature = signature;
    const list = this.root.querySelector('#fishing-catalog');
    list.innerHTML = state.publicFish?.length ? state.publicFish.map(fish => `
      <li>
        <span>${escapeHtml(typeof fish === 'string' ? fish : (fish.name || fish.fishName || ''))}</span>
        <span class="fishing-rarity">${escapeHtml(typeof fish === 'string' ? '' : (fish.rarity || fish.depth || ''))}</span>
      </li>
    `).join('') : '<li class="fishing-empty">Surveying these waters…</li>';
  }

  renderBasket(state) {
    const signature = JSON.stringify([state.basket, state.settlement]);
    if (signature === this.basketSignature) return;
    this.basketSignature = signature;
    const value = Number(state.basket?.value) || 0;
    this.root.querySelector('#fishing-basket-value').textContent = `${value}g`;
    this.root.querySelector('#fishing-basket-header').textContent = `${value}g`;
    const catches = state.basket?.catches || [];
    this.root.querySelector('#fishing-basket').innerHTML = catches.length ? [...catches].reverse().map(catchRecord => `
      <li>
        <span>${escapeHtml(catchRecord.fishName || catchRecord.name || '')}
          <small class="fishing-rarity">${escapeHtml(catchRecord.rarity || '')}${catchRecord.isBigCatch || catchRecord.isBigOne ? ' · Big Catch' : ''}</small>
        </span>
        <strong>${Number(catchRecord.value) || 0}g</strong>
      </li>
    `).join('') : '<li class="fishing-empty">Your basket is empty.</li>';
    const settlement = state.settlement;
    this.root.querySelector('#fishing-settlement').innerHTML = settlement ? `
      <div class="fishing-settlement">
        Basket: ${Number(settlement.basketValue ?? value)}g<br>
        Credited: ${Number(settlement.creditedGold ?? settlement.goldCredited ?? 0)}g<br>
        Overflow: ${Number(settlement.overflowLost ?? settlement.goldOverflow ?? 0)}g
      </div>
    ` : '';
  }

  render(state) {
    if (!this.root) return;
    this.renderGear(state);
    this.renderCatalog(state);
    this.renderBasket(state);

    const phase = state.phase || 'idle';
    const phaseLabel = phase.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    this.root.querySelector('#fishing-phase').textContent = phaseLabel;
    const sessionRemaining = state.sessionEndsAt
      ? Math.max(0, state.sessionEndsAt - state.serverNow)
      : Math.max(0, (30 * 60 * 1000) - (state.serverNow - (state.sessionStartTime || state.serverNow)));
    this.root.querySelector('#fishing-session-time').textContent = formatTime(sessionRemaining);

    const castButton = this.root.querySelector('#fishing-cast-button');
    const hookButton = this.root.querySelector('#fishing-hook-button');
    const cues = this.root.querySelector('#fishing-cues');
    const instruction = this.root.querySelector('#fishing-instruction');
    const castReadyPhases = ['idle', 'resolved', 'caught', 'missed', 'failed', 'cancelled'];
    const terminalPhases = new Set(['resolved', 'caught', 'missed', 'failed', 'expired', 'cancelled']);
    const terminalResult = state.terminalResult;
    const resultBanner = this.root.querySelector('#fishing-result');
    const showResult = terminalPhases.has(phase) && Boolean(terminalResult?.message);
    resultBanner.hidden = !showResult;
    resultBanner.dataset.outcome = showResult ? terminalResult.kind : '';
    this.root.querySelector('#fishing-result-title').textContent = showResult
      ? terminalResult.title
      : '';
    this.root.querySelector('#fishing-result-message').textContent = showResult
      ? terminalResult.message
      : '';
    const nextAttemptPrompt = showResult ? 'Cast again when ready.' : null;
    castButton.hidden = !(castReadyPhases.includes(phase) || phase === 'cast');
    castButton.disabled = !state.active || !selectedKey(state.selectedRod);
    castButton.dataset.mode = phase === 'cast' ? 'release' : 'start';
    castButton.textContent = phase === 'cast' ? 'Release Cast' : 'Hold to Cast';
    const gearEnabled = state.active && castReadyPhases.includes(phase);
    this.root.querySelector('#fishing-rod-select').disabled = !gearEnabled;
    this.root.querySelector('#fishing-tackle-select').disabled = !gearEnabled;
    hookButton.hidden = phase !== 'bite';
    cues.hidden = phase !== 'reel';

    const messages = {
      idle: 'Choose a rod, then hold to build cast power.',
      cast: 'Hold… release at your desired cast depth.',
      wait: 'Watch the bobber and listen for a bite.',
      bite: `Bite! Hook now — ${formatTime(state.remainingMs)}`,
      reel: `Match the tension cues — ${state.attempt?.hits || 0}/${state.attempt?.requiredHits || 0} hits.`,
      resolve: 'Landing the fish…',
      resolved: nextAttemptPrompt || 'Ready for another cast.',
      caught: nextAttemptPrompt || 'Catch secured. Ready for another cast.',
      missed: nextAttemptPrompt || 'The bite was missed. Cast again.',
      failed: nextAttemptPrompt || 'The fish got away. Cast again.',
      cancelled: nextAttemptPrompt || 'The cast was cancelled.',
      expired: nextAttemptPrompt || 'The fishing session has expired.'
    };
    instruction.textContent = messages[phase] || phaseLabel;

    const castStartedAt = state.attempt?.timestamps?.castStartedAt;
    const castElapsed = phase === 'cast'
      ? state.serverNow - (castStartedAt ?? state.castVisualStartedAt ?? state.serverNow)
      : 0;
    const power = Math.min(1, Math.max(0, castElapsed / 1600));
    this.root.querySelector('#fishing-power-fill').style.width = `${power * 100}%`;
    const countdownRemaining = phase === 'reel' ? state.cueRemainingMs : state.remainingMs;
    const deadlineTotal = phase === 'bite' ? 3000 : (state.attempt?.cueDurationMs || 1000);
    const deadlinePercent = countdownRemaining === null
      ? 0
      : Math.min(100, Math.max(0, (countdownRemaining / deadlineTotal) * 100));
    this.root.querySelector('#fishing-countdown-fill').style.width = `${deadlinePercent}%`;

    if (phase === 'reel') {
      const cueActive = Number.isInteger(state.currentCueIndex);
      const currentIndex = cueActive ? state.currentCueIndex : -1;
      const current = cueActive ? state.attempt?.cues?.[currentIndex] : null;
      cues.innerHTML = Object.entries(DIRECTIONS).map(([direction, [symbol, label]]) => `
        <button class="fishing-cue" type="button" data-direction="${direction}" data-cue-index="${currentIndex}" ${cueActive ? '' : 'disabled'}
          aria-label="${label}" aria-pressed="${String(current?.direction === direction)}">
          <span aria-hidden="true">${symbol}</span> ${label}
        </button>
      `).join('');
    } else {
      cues.innerHTML = '';
    }
  }

  destroy() {
    this.abortController?.abort();
    this.abortController = null;
    this.root?.remove();
    this.root = null;
  }
}
