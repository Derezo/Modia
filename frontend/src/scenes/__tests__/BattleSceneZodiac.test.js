import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0, onLine: true }
});
globalThis.document = {
  createElement() {
    return {
      id: '',
      textContent: '',
      style: {},
      classList: { add() {}, remove() {} }
    };
  },
  getElementById() { return null; },
  head: { appendChild() {} },
  body: { appendChild() {} }
};

const frontendRoot = fileURLToPath(new URL('../../../', import.meta.url));
const vite = await createServer({
  root: frontendRoot,
  configFile: fileURLToPath(new URL('../../../vite.config.js', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom'
});
after(async () => vite.close());

const { BattleScene } =
  await vite.ssrLoadModule('/src/scenes/BattleScene.js');
const { parchmentToast } =
  await vite.ssrLoadModule('/src/ui/parchment/ParchmentToast.js');

function createUnit(id, {
  type = 'player',
  teamId = type === 'enemy' ? 2 : 1,
  hp = 100,
  x = 1,
  y = 1
} = {}) {
  return {
    id,
    type,
    teamId,
    hp,
    gridX: x,
    gridY: y,
    name: id,
    isAlive() { return this.hp > 0; }
  };
}

function createHarness() {
  const player = createUnit('player_77');
  const scene = Object.create(BattleScene.prototype);
  Object.assign(scene, {
    battleId: 12,
    battleEnded: false,
    battleState: {
      status: 'active',
      activeUnitId: player.id,
      stateRevision: 4,
      units: [{
        id: player.id,
        characterId: 77,
        type: 'player',
        teamId: 1,
        hp: 100,
        tileX: 1,
        tileY: 1,
        attackRange: 3
      }]
    },
    units: new Map([[player.id, player]]),
    isPvP: false,
    inputEnabled: true,
    isActionSubmitting: false,
    serverAvailableActions: { canMove: false, canAct: false, canWait: true },
    canMove: false,
    canAct: false,
    canWait: true,
    stateRevision: 4,
    zodiacAbilities: [],
    zodiacAvailabilityLoading: false,
    zodiacAvailabilityKey: null,
    zodiacAvailabilityRequestId: 0,
    zodiacAvailabilityController: null,
    zodiacSubmissionRequestId: 0,
    retryableZodiacIntent: null,
    zodiacIntentGeneration: 0,
    processedCommandIds: new Set(),
    currentAction: null,
    pendingAction: null,
    validTiles: [],
    lockedTarget: null,
    actionBar: null,
    radialMenu: null,
    contextMenu: null,
    ui: {
      setActionsEnabled() {},
      showTargetingMode() {},
      showConfirmation() {},
      hideConfirmation() {},
      hideSkillPanel() {},
      hideItemPanel() {},
      hideZodiacPanel() {},
      hideTargetingMode() {},
      clearTargetSticky() {},
      hideActiveUnitPreview() {}
    },
    pathfinding: {
      getAttackableTiles() { return []; }
    },
    game: {
      localUserId: 1,
      api: {}
    },
    wsManager: {
      getNextActionSequence() { return 5; }
    },
    hideRadialMenu() {},
    refreshActionControls() {}
  });
  return { scene, player };
}

describe('BattleScene Zodiac availability and action flow', () => {
  it('uses raw characterId and rejects stale active-unit availability responses', async () => {
    const { scene } = createHarness();
    const second = createUnit('player_88', { x: 2, y: 2 });
    scene.units.set(second.id, second);
    const requests = [];
    scene.game.api.getAvailableZodiacAbilities = (battleId, characterId) =>
      new Promise(resolve => requests.push({ battleId, characterId, resolve }));

    const firstRequest = scene.refreshZodiacAvailability();
    scene.battleState.activeUnitId = second.id;
    scene.battleState.stateRevision = 5;
    scene.battleState.units.push({
      id: second.id,
      characterId: 88,
      type: 'player',
      teamId: 1,
      hp: 100,
      tileX: 2,
      tileY: 2
    });
    scene.stateRevision = 5;
    const secondRequest = scene.refreshZodiacAvailability();
    assert.equal(await scene.refreshZodiacAvailability(), true);
    assert.equal(requests.length, 2, 'same state must reuse the in-flight request key');

    requests[1].resolve({
      availableAbilities: [{ key: 'dreamwave', name: 'Dreamwave', needsTarget: true }]
    });
    assert.equal(await secondRequest, true);
    requests[0].resolve({
      availableAbilities: [{ key: 'venom_sting', name: 'Stale Sting', needsTarget: true }]
    });
    assert.equal(await firstRequest, false);

    assert.deepEqual(
      requests.map(request => request.characterId),
      [77, 88]
    );
    assert.deepEqual(
      scene.zodiacAbilities.map(ability => ability.key),
      ['dreamwave']
    );
  });

  it('allows a same-revision retry after a transient availability failure', async (t) => {
    const { scene } = createHarness();
    let attempts = 0;
    scene.game.api.getAvailableZodiacAbilities = async () => {
      attempts++;
      if (attempts === 1) throw new Error('temporary outage');
      return {
        availableAbilities: [{ key: 'cascade', name: 'Cascade' }]
      };
    };
    const previousWarn = console.warn;
    console.warn = () => {};
    t.after(() => { console.warn = previousWarn; });

    assert.equal(await scene.refreshZodiacAvailability(), false);
    assert.equal(scene.zodiacAvailabilityKey, null);
    assert.equal(await scene.refreshZodiacAvailability(), true);
    assert.equal(attempts, 2);
    assert.deepEqual(scene.zodiacAbilities.map(ability => ability.key), ['cascade']);
  });

  it('remains usable after canAct is spent but locks for submit and remote turns', () => {
    const { scene, player } = createHarness();
    scene.zodiacAbilities = [{ key: 'cascade', name: 'Cascade' }];

    assert.equal(scene.canSubmitAction('attack'), false);
    assert.equal(scene.canSubmitZodiacAbility(), true);
    scene.isActionSubmitting = true;
    assert.equal(scene.canSubmitZodiacAbility(), false);
    scene.isActionSubmitting = false;
    player.type = 'enemy';
    assert.equal(scene.canSubmitZodiacAbility(), false);
  });

  it('uses distinct Zodiac targeting and exposes only living opponents in attack range', (t) => {
    const { scene, player } = createHarness();
    const enemy = createUnit('enemy-live', { type: 'enemy', x: 2, y: 1 });
    const defeated = createUnit('enemy-dead', {
      type: 'enemy',
      hp: 0,
      x: 3,
      y: 1
    });
    const ally = createUnit('ally', { x: 1, y: 2 });
    scene.units = new Map([
      [player.id, player],
      [enemy.id, enemy],
      [defeated.id, defeated],
      [ally.id, ally]
    ]);
    scene.zodiacAbilities = [{
      key: 'dreamwave',
      name: 'Dreamwave',
      needsTarget: true
    }];
    scene.pathfinding.getAttackableTiles = () => [
      { x: 2, y: 1, distance: 1 },
      { x: 3, y: 1, distance: 2 },
      { x: 1, y: 2, distance: 1 }
    ];
    const previousInfo = parchmentToast.info;
    parchmentToast.info = () => {};
    t.after(() => { parchmentToast.info = previousInfo; });

    scene.startZodiacAbility('dreamwave');

    assert.equal(scene.currentAction, 'zodiac_target');
    assert.deepEqual(scene.validTiles, [{
      x: 2,
      y: 1,
      distance: 1,
      unitId: enemy.id
    }]);
    scene.handleTileClick(2, 1);
    assert.equal(scene.pendingAction.targetUnitId, enemy.id);
    assert.equal(scene.lockedTarget.unit, enemy);
  });

  it('prefers authoritative basic-attack range for Zodiac highlighting', (t) => {
    const { scene, player } = createHarness();
    const enemy = createUnit('enemy-far', { type: 'enemy', x: 5, y: 1 });
    scene.units.set(enemy.id, enemy);
    scene.battleState.units[0].attackRange = 1;
    scene.serverAvailableActions.attacks = { range: 4, targets: [enemy.id] };
    scene.zodiacAbilities = [{
      key: 'dreamwave',
      name: 'Dreamwave',
      needsTarget: true
    }];
    let requestedRange;
    scene.pathfinding.getAttackableTiles = (x, y, range) => {
      requestedRange = range;
      return [{ x: 5, y: 1, distance: 4 }];
    };
    const previousInfo = parchmentToast.info;
    parchmentToast.info = () => {};
    t.after(() => { parchmentToast.info = previousInfo; });

    scene.startZodiacAbility('dreamwave');

    assert.equal(requestedRange, 4);
    assert.deepEqual(scene.validTiles, [{
      x: 5,
      y: 1,
      distance: 4,
      unitId: enemy.id
    }]);
    assert.equal(player.id, 'player_77');
  });

  it('defaults legacy Zodiac highlighting to one tile of basic-attack range', (t) => {
    const { scene } = createHarness();
    delete scene.battleState.units[0].attackRange;
    scene.serverAvailableActions.attacks = null;
    scene.zodiacAbilities = [{
      key: 'venom_sting',
      name: 'Venom Sting',
      needsTarget: true
    }];
    let requestedRange;
    scene.pathfinding.getAttackableTiles = (x, y, range) => {
      requestedRange = range;
      return [];
    };
    const previousWarning = parchmentToast.warning;
    parchmentToast.warning = () => {};
    t.after(() => { parchmentToast.warning = previousWarning; });

    scene.startZodiacAbility('venom_sting');

    assert.equal(requestedRange, 1);
  });

  it('uses materialized legacy trait range plus pending bonus without double counting', (t) => {
    const { scene, player } = createHarness();
    const unitState = scene.battleState.units[0];
    unitState.attackRange = 2;
    unitState.traits = [{
      effectType: 'range_bonus',
      effectValue: 1
    }];
    scene.serverAvailableActions.attacks = null;
    scene.zodiacAbilities = [{
      key: 'dreamwave',
      name: 'Dreamwave',
      needsTarget: true
    }];
    let requestedRange;
    scene.pathfinding.getAttackableTiles = (x, y, range) => {
      requestedRange = range;
      return [];
    };
    const previousWarning = parchmentToast.warning;
    parchmentToast.warning = () => {};
    t.after(() => { parchmentToast.warning = previousWarning; });

    assert.equal(scene.getEffectiveBasicAttackRange(player), 2);
    unitState.nextAttackRangeBonus = 2;
    scene.startZodiacAbility('dreamwave');

    assert.equal(requestedRange, 4);
    assert.equal(unitState.nextAttackRangeBonus, 2);
  });

  it('confirms a self ability through the dedicated Zodiac submitter', async () => {
    const { scene } = createHarness();
    scene.zodiacAbilities = [{
      key: 'cascade',
      name: 'Cascade',
      needsTarget: false
    }];
    let submitted;
    scene.submitZodiacAbility = async payload => {
      submitted = payload;
      return true;
    };
    scene.submitAction = async () => {
      assert.fail('generic battle action submission must not be used');
    };

    scene.startZodiacAbility('cascade');
    assert.equal(scene.pendingAction.isSelfTarget, true);
    assert.equal(await scene.confirmAction(), true);
    assert.deepEqual(submitted, {
      abilityKey: 'cascade',
      targetUnitId: undefined
    });
  });

  it('posts target identity and sequence without duplicate local presentation', async (t) => {
    const { scene, player } = createHarness();
    const enemy = createUnit('enemy', { type: 'enemy', x: 2, y: 1 });
    scene.units.set(enemy.id, enemy);
    scene.zodiacAbilities = [{
      key: 'venom_sting',
      name: 'Venom Sting',
      needsTarget: true
    }];
    const calls = { api: [], presentation: 0, logs: 0 };
    scene.game.api = {
      async useZodiacAbility(payload) {
        calls.api.push(payload);
        return {
          success: true,
          abilityKey: 'venom_sting',
          abilityName: 'Venom Sting',
          message: 'Poisoned',
          effects: [],
          stateRevision: 5,
          state: { status: 'active' }
        };
      },
      submitBattleAction() {
        assert.fail('generic endpoint must not be used');
      }
    };
    scene.reconcileAuthoritativePayload = () => true;
    scene.clearActionTargetingState = () => {};
    scene.presentZodiacAbility = () => { calls.presentation++; };
    scene.addBattleLogEntry = () => { calls.logs++; };
    scene.refreshZodiacAvailability = async () => true;
    const previousSuccess = parchmentToast.success;
    parchmentToast.success = () => {};
    t.after(() => { parchmentToast.success = previousSuccess; });

    assert.equal(await scene.submitZodiacAbility({
      abilityKey: 'venom_sting',
      targetUnitId: enemy.id
    }), true);

    assert.equal(calls.api.length, 1);
    assert.equal(typeof calls.api[0].commandId, 'string');
    assert.ok(calls.api[0].commandId.length > 0);
    assert.deepEqual({
      ...calls.api[0],
      commandId: '<generated>'
    }, {
      battleId: 12,
      characterId: 77,
      abilityKey: 'venom_sting',
      targetUnitId: enemy.id,
      actionSequence: 5,
      commandId: '<generated>',
      stateRevision: 4
    });
    assert.equal(calls.presentation, 1);
    assert.equal(calls.logs, 1);
    assert.equal(player.id, 'player_77');
  });

  it('does not let an invalidated same-battle response unlock a newer submission', async () => {
    const { scene } = createHarness();
    scene.zodiacAbilities = [{ key: 'cascade', name: 'Cascade' }];
    let resolveRequest;
    scene.game.api.useZodiacAbility = () => new Promise(resolve => {
      resolveRequest = resolve;
    });

    const oldSubmission = scene.submitZodiacAbility({ abilityKey: 'cascade' });
    scene.zodiacSubmissionRequestId++;
    scene.isActionSubmitting = true;
    resolveRequest({
      success: true,
      stateRevision: 5,
      state: { status: 'active' }
    });

    assert.equal(await oldSubmission, false);
    assert.equal(scene.battleId, 12);
    assert.equal(scene.isActionSubmitting, true);
  });

  it('does not clear newer availability when reconciliation rejects a stale success', async () => {
    const { scene } = createHarness();
    scene.stateRevision = 6;
    scene.battleState.stateRevision = 6;
    scene.zodiacAvailabilityKey = '12:player_77:77:6';
    scene.zodiacAbilities = [
      { key: 'cascade', name: 'Cascade' },
      { key: 'balance', name: 'Balance' }
    ];
    scene.currentAction = 'move';
    scene.selectedZodiacAbilityKey = null;
    scene.game.api = {
      async useZodiacAbility() {
        return {
          success: true,
          stateRevision: 5,
          state: { status: 'active' }
        };
      },
      async getAvailableZodiacAbilities() {
        assert.fail('the newer availability key should be reused');
      }
    };
    scene.reconcileAuthoritativePayload = () => false;
    let cleared = false;
    scene.clearActionTargetingState = () => { cleared = true; };

    assert.equal(
      await scene.submitZodiacAbility({ abilityKey: 'cascade' }),
      true
    );
    assert.equal(cleared, false);
    assert.deepEqual(
      scene.zodiacAbilities.map(ability => ability.key),
      ['cascade', 'balance']
    );
    assert.equal(scene.zodiacAvailabilityKey, '12:player_77:77:6');
  });

  it('reuses command identity after a lost response and presents the accepted replay once', async (t) => {
    const { scene } = createHarness();
    scene.zodiacAbilities = [{
      key: 'venom_sting',
      name: 'Venom Sting',
      needsTarget: true
    }];
    const requests = [];
    let attempt = 0;
    scene.game.api.useZodiacAbility = async payload => {
      requests.push(payload);
      if (attempt++ === 0) {
        throw new Error('Connection closed before the response arrived');
      }
      return {
        success: true,
        replayed: true,
        commandId: payload.commandId,
        abilityKey: 'venom_sting',
        abilityName: 'Venom Sting',
        effects: [],
        stateRevision: 5,
        state: { status: 'active' }
      };
    };
    scene.reconcileAuthoritativePayload = result => {
      scene.noteStateRevision(result.stateRevision);
      return true;
    };
    scene.clearActionTargetingState = () => {};
    let presentations = 0;
    let logs = 0;
    scene.presentZodiacAbility = () => { presentations++; };
    scene.addBattleLogEntry = () => { logs++; };
    scene.refreshZodiacAvailability = async () => true;
    const previousError = parchmentToast.error;
    const previousSuccess = parchmentToast.success;
    parchmentToast.error = () => {};
    parchmentToast.success = () => {};
    t.after(() => {
      parchmentToast.error = previousError;
      parchmentToast.success = previousSuccess;
    });

    const intent = {
      abilityKey: 'venom_sting',
      targetUnitId: 'enemy-2'
    };
    assert.equal(await scene.submitZodiacAbility(intent), false);
    assert.equal(presentations, 0);
    assert.ok(scene.retryableZodiacIntent);

    assert.equal(await scene.submitZodiacAbility(intent), true);

    assert.equal(requests.length, 2);
    assert.equal(requests[1].commandId, requests[0].commandId);
    assert.equal(requests[1].actionSequence, requests[0].actionSequence);
    assert.equal(requests[1].stateRevision, requests[0].stateRevision);
    assert.equal(requests[1].stateRevision, 4);
    assert.equal(scene.retryableZodiacIntent, null);
    assert.equal(scene.processedCommandIds.has(requests[0].commandId), true);
    assert.equal(presentations, 1);
    assert.equal(logs, 1);
  });

  it('discards ambiguous Zodiac identity for a different target or newer revision', async (t) => {
    const { scene } = createHarness();
    scene.zodiacAbilities = [{
      key: 'dreamwave',
      name: 'Dreamwave',
      needsTarget: true
    }];
    const requests = [];
    scene.game.api.useZodiacAbility = async payload => {
      requests.push(payload);
      throw new Error('Temporary network failure');
    };
    const previousError = parchmentToast.error;
    parchmentToast.error = () => {};
    t.after(() => { parchmentToast.error = previousError; });

    assert.equal(await scene.submitZodiacAbility({
      abilityKey: 'dreamwave',
      targetUnitId: 'enemy-a'
    }), false);
    const firstCommandId = scene.retryableZodiacIntent.commandId;

    assert.equal(await scene.submitZodiacAbility({
      abilityKey: 'dreamwave',
      targetUnitId: 'enemy-b'
    }), false);
    assert.notEqual(requests[1].commandId, firstCommandId);
    assert.equal(
      scene.retryableZodiacIntent.commandId,
      requests[1].commandId
    );

    scene.noteStateRevision(5);
    assert.equal(scene.retryableZodiacIntent, null);
  });

  it('clears ambiguous Zodiac identity on authoritative error recovery', async (t) => {
    const { scene } = createHarness();
    scene.zodiacAbilities = [{ key: 'cascade', name: 'Cascade' }];
    scene.retryableZodiacIntent = {
      signature: JSON.stringify({
        battleId: '12',
        characterId: '77',
        abilityKey: 'cascade',
        targetUnitId: null
      }),
      commandId: 'zodiac-retry',
      actionSequence: 5,
      baseRevision: 4
    };
    const recovery = {
      stateRevision: 5,
      state: { status: 'active' }
    };
    scene.game.api.useZodiacAbility = async () => {
      const error = new Error('State conflict');
      error.data = recovery;
      throw error;
    };
    let reconciled;
    scene.reconcileAuthoritativePayload = payload => {
      reconciled = payload;
      return true;
    };
    const previousError = parchmentToast.error;
    parchmentToast.error = () => {};
    t.after(() => { parchmentToast.error = previousError; });

    assert.equal(await scene.submitZodiacAbility({
      abilityKey: 'cascade'
    }), false);
    assert.equal(reconciled, recovery);
    assert.equal(scene.retryableZodiacIntent, null);
  });

  it('does not recreate ambiguous identity after a newer revision arrives in flight', async (t) => {
    const { scene } = createHarness();
    scene.zodiacAbilities = [{ key: 'cascade', name: 'Cascade' }];
    let rejectRequest;
    scene.game.api.useZodiacAbility = () => new Promise((resolve, reject) => {
      rejectRequest = reject;
    });
    const previousError = parchmentToast.error;
    parchmentToast.error = () => {};
    t.after(() => { parchmentToast.error = previousError; });

    const submission = scene.submitZodiacAbility({ abilityKey: 'cascade' });
    scene.noteStateRevision(5);
    rejectRequest(new Error('Connection failed after the server may have committed'));

    assert.equal(await submission, false);
    assert.equal(scene.stateRevision, 5);
    assert.equal(scene.retryableZodiacIntent, null);
  });

  it('does not recreate ambiguous identity after a recovered local turn arrives in flight', async (t) => {
    const { scene, player } = createHarness();
    scene.zodiacAbilities = [{ key: 'balance', name: 'Balance' }];
    let rejectRequest;
    scene.game.api.useZodiacAbility = () => new Promise((resolve, reject) => {
      rejectRequest = reject;
    });
    scene.clearActionTargetingState = () => {};
    scene.updateUI = () => {};
    const previousError = parchmentToast.error;
    parchmentToast.error = () => {};
    t.after(() => { parchmentToast.error = previousError; });

    const submission = scene.submitZodiacAbility({ abilityKey: 'balance' });
    scene.inputEnabled = false;
    assert.equal(scene.recoverLocalTurn({
      unitId: player.id,
      availableActions: { canMove: true, canAct: true, canWait: true },
      stateRevision: 4
    }), true);
    rejectRequest(new Error('Connection failed after the server may have committed'));

    assert.equal(await submission, false);
    assert.equal(scene.retryableZodiacIntent, null);
  });
});
