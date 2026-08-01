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
  server: { middlewareMode: true, hmr: false },
  appType: 'custom'
});
after(async () => vite.close());

const { BattleScene } =
  await vite.ssrLoadModule('/src/scenes/BattleScene.js');
const { parchmentToast } =
  await vite.ssrLoadModule('/src/ui/parchment/ParchmentToast.js');

function createTargetingHarness() {
  const activeUnit = {
    id: 'caster',
    type: 'player',
    gridX: 4,
    gridY: 4,
    hp: 100,
    mp: 100
  };
  const scene = Object.create(BattleScene.prototype);
  Object.assign(scene, {
    currentAction: null,
    selectedSkillId: null,
    pendingAction: null,
    lockedTarget: null,
    validTiles: [],
    serverAvailableActions: null,
    attackRange: 2,
    units: new Map([[activeUnit.id, activeUnit]]),
    pathfinding: {
      getAttackableTiles() {
        return [{ x: 5, y: 4, distance: 1 }];
      }
    },
    ui: {
      setActionsEnabled() {},
      showTargetingMode() {},
      hideSkillPanel() {},
      hideConfirmation() {},
      showConfirmation() {},
      showActiveUnitPreview() {}
    },
    grid: {
      gridToScreenWorld(x, y) { return { x, y }; }
    },
    animations: {
      addSelfAuraEffect() {}
    },
    game: {
      getUserSetting() { return false; }
    },
    hideRadialMenu() {},
    hideRadialMenuIfOpen() {},
    canSubmitAction() { return true; },
    getActiveUnit() { return activeUnit; },
    getUnitActiveSkills() { return []; }
  });
  return { scene, activeUnit };
}

describe('BattleScene tile-first targeting', () => {
  it('uses every authoritative attack tile instead of the occupied target list', () => {
    const { scene } = createTargetingHarness();
    scene.serverAvailableActions = {
      attacks: {
        range: 2,
        targets: [{ x: 5, y: 4, unitId: 'enemy' }],
        tiles: [
          { x: 3, y: 4, distance: 1 },
          { x: 4, y: 5, distance: 1 },
          { x: 5, y: 4, distance: 1 }
        ]
      }
    };

    scene.startAttackAction();

    assert.deepEqual(scene.validTiles, [
      { x: 3, y: 4, unitId: undefined, distance: 1 },
      { x: 4, y: 5, unitId: undefined, distance: 1 },
      { x: 5, y: 4, unitId: undefined, distance: 1 }
    ]);
  });

  it('derives attack tiles locally for legacy occupied-target payloads', () => {
    const { scene } = createTargetingHarness();
    const calls = [];
    scene.serverAvailableActions = {
      attacks: {
        range: 3,
        targets: [{ x: 5, y: 4, unitId: 'enemy' }]
      }
    };
    scene.pathfinding.getAttackableTiles = (...args) => {
      calls.push(args);
      return [{ x: 4, y: 7, distance: 3 }];
    };

    scene.startAttackAction();

    assert.deepEqual(calls, [[4, 4, 3]]);
    assert.deepEqual(scene.validTiles, [{ x: 4, y: 7, distance: 3 }]);
  });

  it('uses authoritative skill tiles regardless of occupancy or allegiance', () => {
    const { scene } = createTargetingHarness();
    const lightning = {
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      range: 5,
      mpCost: 8,
      damage: 140
    };
    scene.getUnitActiveSkills = () => [lightning];
    scene.serverAvailableActions = {
      skills: [{
        ...lightning,
        targets: [{ x: 7, y: 4, unitId: 'enemy' }],
        tiles: [
          { x: 4, y: 4, distance: 0 },
          { x: 3, y: 4, distance: 1 },
          { x: 4, y: 5, distance: 1 },
          { x: 7, y: 4, distance: 3 }
        ]
      }]
    };

    scene.startSkillAction(lightning.id);

    assert.deepEqual(
      scene.validTiles.map(({ x, y }) => ({ x, y })),
      [
        { x: 4, y: 4 },
        { x: 3, y: 4 },
        { x: 4, y: 5 },
        { x: 7, y: 4 }
      ]
    );
  });

  it('includes the caster tile when deriving legacy skill ranges', () => {
    const { scene } = createTargetingHarness();
    const skill = {
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      range: 5,
      mpCost: 8,
      damage: 140
    };
    scene.getUnitActiveSkills = () => [skill];
    scene.serverAvailableActions = {
      skills: [{ ...skill, targets: [{ x: 5, y: 4, unitId: 'enemy' }] }]
    };

    scene.startSkillAction(skill.id);

    assert.deepEqual(scene.validTiles, [
      { x: 4, y: 4, unitId: 'caster', distance: 0 },
      { x: 5, y: 4, distance: 1 }
    ]);
  });

  it('derives offensive skill tiles without authoritative availability', () => {
    const { scene } = createTargetingHarness();
    const skill = {
      id: 'lightning_bolt',
      name: 'Lightning Bolt',
      range: 5,
      mpCost: 8,
      damage: 140
    };
    scene.getUnitActiveSkills = () => [skill];

    assert.doesNotThrow(() => scene.startSkillAction(skill.id));
    assert.deepEqual(scene.validTiles, [
      { x: 4, y: 4, unitId: 'caster', distance: 0 },
      { x: 5, y: 4, distance: 1 }
    ]);
  });

  it('keeps legacy intrinsic self skills on the caster', () => {
    const { scene } = createTargetingHarness();
    const meditation = {
      id: 'meditation',
      name: 'Meditation',
      range: 3,
      mpCost: 0,
      healPercent: 15,
      targetSelf: true
    };
    scene.getUnitActiveSkills = () => [meditation];
    scene.serverAvailableActions = {
      skills: [{
        ...meditation,
        targets: [{ x: 4, y: 4, unitId: 'caster' }]
      }]
    };
    parchmentToast.info = () => {};

    scene.startSkillAction(meditation.id);

    assert.deepEqual(scene.validTiles, [{
      x: 4,
      y: 4,
      unitId: 'caster',
      isSelf: true
    }]);
    assert.deepEqual(scene.pendingAction?.targetTile, { x: 4, y: 4 });
  });

  it('keeps legacy party-wide skills caster-centered at positive range', () => {
    const { scene } = createTargetingHarness();
    const partyHeal = {
      id: 'party_heal',
      name: 'Party Heal',
      range: 3,
      mpCost: 10,
      healPercent: 20,
      targetAllAllies: true
    };
    scene.getUnitActiveSkills = () => [partyHeal];
    scene.serverAvailableActions = {
      skills: [{
        ...partyHeal,
        targets: [{ x: 4, y: 4, unitId: 'caster' }]
      }]
    };

    scene.startSkillAction(partyHeal.id);

    assert.deepEqual(scene.validTiles, [{
      x: 4,
      y: 4,
      unitId: 'caster',
      distance: 0
    }]);
  });

  it('submits a selected tile even if its preview occupant was defeated', async () => {
    const { scene } = createTargetingHarness();
    const defeatedPreview = { id: 'former-occupant', hp: 0 };
    scene.pendingAction = {
      type: 'skill',
      skillId: 'lightning_bolt',
      targetTile: { x: 6, y: 4 },
      target: defeatedPreview
    };
    scene.lockedTarget = {
      tile: { x: 6, y: 4 },
      unit: defeatedPreview
    };
    let submission = null;
    scene.submitAction = async (type, tile) => {
      submission = { type, tile };
      return true;
    };
    scene.cancelAction = () => {
      scene.pendingAction = null;
    };

    const confirmed = await scene.confirmAction();

    assert.equal(confirmed, true);
    assert.deepEqual(submission, {
      type: 'skill',
      tile: { x: 6, y: 4 }
    });
  });
});
