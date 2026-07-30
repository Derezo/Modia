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

function createSceneHarness() {
  const unit = { id: 'player', type: 'player', mp: 10 };
  const scene = Object.create(BattleScene.prototype);
  Object.assign(scene, {
    battleId: 11,
    battleEnded: false,
    battleState: {
      status: 'active',
      activeUnitId: unit.id,
      units: [{ id: unit.id }]
    },
    units: new Map([[unit.id, unit]]),
    isPvP: false,
    inputEnabled: true,
    isActionSubmitting: false,
    serverAvailableActions: null,
    canMove: false,
    canAct: false,
    turnPhase: 'done',
    stateRevision: 3,
    retryableActionIntent: null,
    processedCommandIds: new Set(),
    pendingAction: null,
    selectedSkillId: null,
    selectedItemId: null,
    selectedInventoryId: null,
    currentAction: null,
    validTiles: [],
    lockedTarget: null,
    actionBar: null,
    radialMenu: null,
    ui: {
      setActionsEnabled() {},
      updateAvailableActions() {}
    },
    game: {
      localUserId: 1,
      api: null
    },
    wsManager: {
      sequence: 0,
      getNextActionSequence() {
        this.sequence++;
        return this.sequence;
      }
    },
    hideRadialMenu() {}
  });
  return { scene, unit };
}

describe('BattleScene authoritative action gate', () => {
  for (const actionType of ['skill', 'attack', 'item']) {
    it(`allows ${actionType} → move without granting a second action`, () => {
      const { scene } = createSceneHarness();
      scene.applyAuthoritativeAvailability({
        canMove: true,
        canAct: false
      });

      assert.equal(scene.canSubmitAction(actionType), false);
      assert.equal(scene.canSubmitAction('move'), true);
    });
  }

  it('requires input, the active local actor, an active battle, and no in-flight request', () => {
    const { scene, unit } = createSceneHarness();
    scene.applyAuthoritativeAvailability({ canMove: true, canAct: true });

    assert.equal(scene.canSubmitAction('attack'), true);
    scene.inputEnabled = false;
    assert.equal(scene.canSubmitAction('attack'), false);
    scene.inputEnabled = true;
    scene.isActionSubmitting = true;
    assert.equal(scene.canSubmitAction('attack'), false);
    scene.isActionSubmitting = false;
    unit.type = 'enemy';
    assert.equal(scene.canSubmitAction('attack'), false);
    unit.type = 'player';
    scene.battleState.status = 'victory';
    assert.equal(scene.canSubmitAction('attack'), false);
  });

  it('keeps end-turn available when status effects block move and act', () => {
    const { scene } = createSceneHarness();
    scene.applyAuthoritativeAvailability({
      canMove: false,
      canAct: false,
      canWait: true,
      turnPhase: 'ready'
    });

    assert.equal(scene.canSubmitAction('move'), false);
    assert.equal(scene.canSubmitAction('attack'), false);
    assert.equal(scene.canSubmitAction('wait'), true);
    assert.equal(scene.canSubmitAction('any'), true);
  });

  it('accepts legacy active state without a status and expires retry identity on revision advance', () => {
    const { scene } = createSceneHarness();
    delete scene.battleState.status;
    scene.applyAuthoritativeAvailability({ canMove: true, canAct: true });
    scene.retryableActionIntent = {
      commandId: 'old-command',
      baseRevision: 3
    };

    assert.equal(scene.canSubmitAction('move'), true);
    scene.noteStateRevision(4);
    assert.equal(scene.retryableActionIntent, null);
  });

  it('keeps one command identity for an ambiguous retry and blocks a double submit', async (t) => {
    const { scene } = createSceneHarness();
    scene.applyAuthoritativeAvailability({ canMove: true, canAct: true });
    scene.pendingAction = {
      type: 'item',
      targetTile: { x: 1, y: 2 },
      itemId: 'potion'
    };
    scene.selectedItemId = 'potion';
    scene.selectedInventoryId = 77;
    scene.processActionResult = async () => true;

    const previousError = parchmentToast.error;
    const previousWarning = parchmentToast.warning;
    parchmentToast.error = () => {};
    parchmentToast.warning = () => {};
    t.after(() => {
      parchmentToast.error = previousError;
      parchmentToast.warning = previousWarning;
    });

    const requests = [];
    let resolveRequest;
    let attempt = 0;
    scene.game.api = {
      async submitBattleAction(payload) {
        requests.push(payload);
        attempt++;
        if (attempt === 1) {
          const error = new Error('Gateway timed out after the action may have committed');
          error.status = 503;
          error.data = { error: 'Gateway timeout' };
          throw error;
        }
        return new Promise(resolve => {
          resolveRequest = resolve;
        });
      }
    };

    assert.equal(await scene.submitAction('item', { x: 1, y: 2 }), false);
    scene.stateRevision = 99;
    const retry = scene.submitAction('item', { x: 1, y: 2 });
    assert.equal(await scene.submitAction('item', { x: 1, y: 2 }), false);
    resolveRequest({
      stateRevision: 4,
      state: { status: 'active', units: [] },
      actionResult: {},
      battleStatus: 'active',
      turnContinues: true,
      availableActions: { canMove: true, canAct: false }
    });
    assert.equal(await retry, true);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].commandId, requests[1].commandId);
    assert.equal(requests[0].actionSequence, requests[1].actionSequence);
    assert.equal(requests[0].stateRevision, 3);
    assert.equal(requests[1].stateRevision, 3);
    assert.equal(requests[1].inventoryId, 77);
  });

  it('flushes deferred authoritative state after local action presentation', async () => {
    const { scene } = createSceneHarness();
    scene.applyAuthoritativeAvailability({ canMove: true, canAct: true });
    scene.processActionResult = async () => true;
    scene.game.api = {
      async submitBattleAction() {
        return { actionResult: {}, battleStatus: 'active' };
      }
    };
    let flushes = 0;
    scene.wsManager.flushDeferredAuthoritativeState = () => {
      flushes++;
      return true;
    };

    assert.equal(await scene.submitAction('wait'), true);
    assert.equal(scene.isActionSubmitting, false);
    assert.equal(flushes, 1);
  });

  it('recovers a direct local successor from the turn-ending action response', async () => {
    const { scene, unit } = createSceneHarness();
    const successorAvailability = {
      canMove: true,
      canAct: true,
      canWait: true,
      turnPhase: 'ready'
    };
    scene.inEnemySequence = false;
    scene.updateUI = () => {};
    scene.addBattleLogEntry = () => {};
    scene.playActionPresentation = () => null;
    scene.syncUnitsWithState = () => {};
    scene.ui.clearTargetSticky = () => {};

    const processed = await scene.processActionResult({
      stateRevision: 4,
      state: {
        status: 'active',
        activeUnitId: unit.id,
        units: [{ id: unit.id }]
      },
      actionResult: {},
      battleStatus: 'active',
      turnContinues: false,
      availableActions: successorAvailability
    }, {
      type: 'wait',
      unitId: unit.id
    });

    assert.equal(processed, true);
    assert.equal(scene.stateRevision, 4);
    assert.equal(scene.battleState.activeUnitId, unit.id);
    assert.deepEqual(scene.serverAvailableActions, successorAvailability);
    assert.equal(scene.inputEnabled, true);
    assert.equal(scene.inEnemySequence, false);
    assert.equal(scene.wsManager.lastYourTurnUnitId, unit.id);
  });

  it('does not let an HTTP result become stale during presentation and overwrite a recovered local turn', async () => {
    const { scene, unit } = createSceneHarness();
    const enemy = {
      id: 'enemy',
      type: 'enemy',
      hp: 100,
      maxHp: 100,
      screenX: 0,
      screenY: 0,
      playHitAnimation() {},
      playDeathAnimation() {},
      isAlive() { return this.hp > 0; }
    };
    scene.units.set(enemy.id, enemy);
    scene.battleState.units = [
      { id: unit.id, hp: 100 },
      { id: enemy.id, hp: 100 }
    ];
    scene.inEnemySequence = false;
    scene.updateUI = () => {};
    scene.updateUIForPartialTurn = () => {};
    scene.addBattleLogEntry = () => {};
    scene.ui.clearTargetSticky = () => {};
    scene.playActionPresentation = () => ({ descriptor: {} });
    scene.audioManager = {
      playImpactSound() {},
      playStatusEffectSound() {}
    };
    scene.animations = {
      addDamageNumber() {},
      addFlash() {},
      addParticleBurst() {}
    };
    scene.syncUnitsWithState = stateUnits => {
      for (const stateUnit of stateUnits) {
        const renderedUnit = scene.units.get(stateUnit.id);
        if (renderedUnit && stateUnit.hp !== undefined) {
          renderedUnit.hp = stateUnit.hp;
        }
      }
    };
    scene.applyAuthoritativeAvailability({ canMove: false, canAct: true });

    let signalPresentationStarted;
    const presentationStarted = new Promise(resolve => {
      signalPresentationStarted = resolve;
    });
    let resumePresentation;
    const presentationResume = new Promise(resolve => {
      resumePresentation = resolve;
    });
    let waitCount = 0;
    scene.waitForAnimation = async () => {
      waitCount++;
      if (waitCount === 1) {
        signalPresentationStarted();
        await presentationResume;
      }
    };

    const staleResult = scene.processActionResult({
      stateRevision: 4,
      state: {
        status: 'active',
        activeUnitId: enemy.id,
        units: [
          { id: unit.id, hp: 100 },
          { id: enemy.id, hp: 70 }
        ]
      },
      actionResult: {
        damage: 20,
        targetId: enemy.id
      },
      battleStatus: 'active',
      turnContinues: false,
      availableActions: {
        canMove: false,
        canAct: false
      }
    }, {
      type: 'attack',
      unitId: unit.id,
      targetTile: { x: 1, y: 1 }
    });

    await presentationStarted;

    const recoveredAvailability = {
      canMove: true,
      canAct: true,
      canWait: true,
      turnPhase: 'ready'
    };
    scene.reconcileAuthoritativePayload({
      stateRevision: 5,
      state: {
        status: 'active',
        activeUnitId: unit.id,
        units: [
          { id: unit.id, hp: 100 },
          { id: enemy.id, hp: 95 }
        ]
      },
      availableActions: recoveredAvailability
    }, { refresh: false });
    scene.recoverLocalTurn({
      unitId: unit.id,
      availableActions: recoveredAvailability,
      stateRevision: 5
    });
    resumePresentation();

    assert.equal(await staleResult, true);
    assert.equal(scene.stateRevision, 5);
    assert.equal(scene.battleState.activeUnitId, unit.id);
    assert.equal(enemy.hp, 95);
    assert.deepEqual(scene.serverAvailableActions, recoveredAvailability);
    assert.equal(scene.canMove, true);
    assert.equal(scene.canAct, true);
    assert.equal(scene.inputEnabled, true);
    assert.equal(scene.inEnemySequence, false);
  });
});
