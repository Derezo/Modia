/**
 * Tracks purchases against a single RecruitmentScene entry. A token from an
 * exited entry can never become current again, even if its request settles
 * after a later entry has started.
 */
export class RecruitmentPurchaseLifecycle {
  constructor() {
    this.generation = 0;
    this.active = false;
    this.pendingToken = null;
  }

  activateEntry() {
    this.generation += 1;
    this.active = true;
    this.pendingToken = null;
    return this.generation;
  }

  invalidateEntry() {
    this.generation += 1;
    this.active = false;
    this.pendingToken = null;
  }

  beginPurchase() {
    if (!this.active || this.pendingToken) return null;

    const token = Object.freeze({ generation: this.generation });
    this.pendingToken = token;
    return token;
  }

  isCurrent(token) {
    return Boolean(
      this.active &&
      token &&
      token === this.pendingToken &&
      token.generation === this.generation
    );
  }

  finishPurchase(token) {
    if (token !== this.pendingToken) return false;
    this.pendingToken = null;
    return true;
  }

  get inProgress() {
    return this.pendingToken !== null;
  }
}

/**
 * Apply a successful Guild Hall purchase to every client-side session cache.
 * The recruited character is inserted idempotently without replacing the
 * current party leader; it becomes active only when no active character exists.
 */
export function synchronizeRecruitPurchaseState(state, result) {
  if (!state || !result) return;

  if (result.remainingGold !== undefined) {
    const user = state.get('user') || {};
    state.set('user', { ...user, gold: result.remainingGold });
    state.set('gold', result.remainingGold);
  }

  const character = result.character;
  if (!character) return;

  const currentCharacters = state.get('characters');
  const characters = Array.isArray(currentCharacters) ? [...currentCharacters] : [];
  const existingIndex = characters.findIndex(entry => (
    character.id !== undefined && entry?.id === character.id
  ));
  if (existingIndex >= 0) characters[existingIndex] = character;
  else characters.push(character);
  state.set('characters', characters);

  const activeCharacter = state.get('activeCharacter');
  if (!activeCharacter || activeCharacter.id === character.id) {
    state.set('activeCharacter', character);
  }
}
