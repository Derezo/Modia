import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let visitCurrentShrine;
let travelToNode;
let refreshZodiacCollection;
let exitScene;
let parchmentToast;

before(async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0 }
  });
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.document = {
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {},
      addEventListener() {},
      remove() {}
    }),
    getElementById: () => null,
    head: { appendChild() {} },
    body: { appendChild() {} }
  };

  server = await createServer({
    configFile: './vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom'
  });

  const sceneModule = await server.ssrLoadModule('/src/scenes/WorldMapScene.js');
  const toastModule = await server.ssrLoadModule('/src/ui/parchment/ParchmentToast.js');
  visitCurrentShrine = sceneModule.WorldMapScene.prototype.visitCurrentShrine;
  travelToNode = sceneModule.WorldMapScene.prototype.travelToNode;
  refreshZodiacCollection = sceneModule.WorldMapScene.prototype.refreshZodiacCollection;
  exitScene = sceneModule.WorldMapScene.prototype.exit;
  parchmentToast = toastModule.parchmentToast;
});

after(async () => {
  await server?.close();
});

function createScene(overrides = {}) {
  const pendingStates = [];
  const cooldowns = [];
  const rebuiltNodes = [];
  const stateUpdates = [];
  const playedSounds = [];
  let zodiacRefreshCount = 0;
  let worldRefreshCount = 0;
  let staminaRefreshCount = 0;
  let authUserId = 7;

  const shrine = {
    id: 84,
    node_type: 'shrine',
    zodiac_sign: 'aries',
    features: []
  };
  const scene = {
    sceneSessionEpoch: 0,
    shrineVisitPending: false,
    shrineVisitRequestId: 0,
    travelPending: false,
    travelRequestId: 0,
    isTraveling: false,
    currentNode: shrine,
    nodes: [shrine, { id: 99, node_type: 'town' }],
    nodeActionMenu: {
      setActionPending(_feature, pending) {
        pendingStates.push(pending);
      },
      rebuildActions(node) {
        rebuiltNodes.push(node);
      },
      setShrineCooldown(value) {
        cooldowns.push(value);
      },
      destroy() {}
    },
    game: {
      api: {
        visitShrine: async () => ({
          success: true,
          buff_name: "Ram's Charge",
          crystalAwarded: true,
          message: "You received Ram's Charge and collected a crystal."
        })
      },
      audio: {
        playInteraction(sound) {
          playedSounds.push(sound);
        }
      },
      state: {
        get(key) {
          return key === 'user' ? { id: authUserId } : null;
        },
        set(key, value) {
          stateUpdates.push([key, value]);
        }
      }
    },
    cleanupWebSocketHandlers() {},
    async refreshZodiacCollection() {
      zodiacRefreshCount += 1;
    },
    async refreshNodes() {
      worldRefreshCount += 1;
    },
    async refreshStamina() {
      staminaRefreshCount += 1;
    },
    ...overrides
  };

  return {
    scene,
    pendingStates,
    cooldowns,
    rebuiltNodes,
    stateUpdates,
    playedSounds,
    setAuthUserId: value => {
      authUserId = value;
    },
    getZodiacRefreshCount: () => zodiacRefreshCount,
    getWorldRefreshCount: () => worldRefreshCount,
    getStaminaRefreshCount: () => staminaRefreshCount
  };
}

function futureIso(hours = 6) {
  return new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString();
}

describe('WorldMapScene shrine visit flow', () => {
  it('guards duplicate visits, applies local cooldown, and refreshes zodiac HUD data', async () => {
    let resolveVisit;
    let visitCount = 0;
    const visitResult = new Promise(resolve => {
      resolveVisit = resolve;
    });
    const fixture = createScene();
    fixture.scene.game.api.visitShrine = nodeId => {
      assert.equal(nodeId, 84);
      visitCount += 1;
      return visitResult;
    };

    const successCalls = [];
    parchmentToast.success = (...args) => successCalls.push(args);

    const firstVisit = visitCurrentShrine.call(fixture.scene);
    await visitCurrentShrine.call(fixture.scene);

    assert.equal(visitCount, 1);
    assert.deepEqual(fixture.pendingStates, [true]);

    const cooldownUntil = futureIso();
    resolveVisit({
      success: true,
      buff_name: "Ram's Charge",
      shrine_cooldown_until: cooldownUntil,
      crystalAwarded: true,
      message: "You received Ram's Charge and collected the Crystal of the Ram!"
    });
    await firstVisit;

    assert.equal(fixture.scene.currentNode.shrine_cooldown_until, cooldownUntil);
    assert.equal(fixture.scene.nodes[0].shrine_cooldown_until, cooldownUntil);
    assert.equal(fixture.rebuiltNodes.at(-1).shrine_cooldown_until, cooldownUntil);
    assert.deepEqual(fixture.cooldowns, [Date.parse(cooldownUntil)]);
    assert.deepEqual(fixture.playedSounds, ['shrine_activate']);
    assert.equal(fixture.getZodiacRefreshCount(), 1);
    assert.equal(fixture.getWorldRefreshCount(), 1);
    assert.deepEqual(fixture.pendingStates, [true, false]);
    assert.deepEqual(successCalls, [[
      'Blessing & Crystal Received',
      "You received Ram's Charge and collected the Crystal of the Ram!"
    ]]);
    assert.equal(fixture.scene.shrineVisitPending, false);
    assert.equal(
      fixture.stateUpdates.some(([key]) => key === 'worldNodes'),
      true
    );
    assert.equal(
      fixture.stateUpdates.some(([key]) => key === 'currentNode'),
      true
    );
  });

  it('accepts camel-case cooldown timing from the response', async () => {
    const cooldownUntil = futureIso();
    const fixture = createScene({
      currentNode: { id: 84, node_type: 'shrine', features: [] },
      nodes: [{ id: 84, node_type: 'shrine', features: [] }]
    });
    fixture.scene.game.api.visitShrine = async () => ({
      success: true,
      buffName: "Pilgrim's Rest",
      buffType: 'stamina_regen',
      cooldownExpiresAt: cooldownUntil
    });
    parchmentToast.success = () => {};

    await visitCurrentShrine.call(fixture.scene);

    assert.equal(fixture.scene.currentNode.shrine_cooldown_until, cooldownUntil);
    assert.deepEqual(fixture.cooldowns, [Date.parse(cooldownUntil)]);
    assert.equal(fixture.getZodiacRefreshCount(), 0);
    assert.equal(fixture.getWorldRefreshCount(), 1);
    assert.equal(fixture.getStaminaRefreshCount(), 1);
  });

  it('falls back to the documented six-hour cooldown when no cooldown field is returned', async () => {
    const fixture = createScene({
      currentNode: { id: 84, node_type: 'shrine', features: [] },
      nodes: [{ id: 84, node_type: 'shrine', features: [] }]
    });
    fixture.scene.game.api.visitShrine = async () => ({
      success: true,
      buff_name: "Pilgrim's Rest"
    });
    parchmentToast.success = () => {};
    const startedAt = Date.now();

    await visitCurrentShrine.call(fixture.scene);

    const cooldownUntil = Date.parse(fixture.scene.currentNode.shrine_cooldown_until);
    assert.ok(cooldownUntil >= startedAt + (6 * 60 * 60 * 1000));
    assert.ok(cooldownUntil <= Date.now() + (6 * 60 * 60 * 1000));
  });

  it('shows an error and restores the action when activation fails', async () => {
    const fixture = createScene();
    fixture.scene.game.api.visitShrine = async () => {
      throw new Error('Shrine is on cooldown. Return in 4 hour(s).');
    };

    const errorCalls = [];
    parchmentToast.error = (...args) => errorCalls.push(args);

    await visitCurrentShrine.call(fixture.scene);

    assert.deepEqual(errorCalls, [[
      'Blessing Unavailable',
      'Shrine is on cooldown. Return in 4 hour(s).'
    ]]);
    assert.deepEqual(fixture.pendingStates, [true, false]);
    assert.deepEqual(fixture.playedSounds, []);
    assert.equal(fixture.scene.shrineVisitPending, false);
  });

  it('recovers cooldown state from a structured cooldown error', async () => {
    const cooldownUntil = futureIso(5);
    const fixture = createScene();
    fixture.scene.game.api.visitShrine = async () => {
      const error = new Error('Shrine is on cooldown. Return in 5 hour(s).');
      error.data = {
        shrine_on_cooldown: true,
        shrine_cooldown_until: cooldownUntil
      };
      throw error;
    };

    const warningCalls = [];
    parchmentToast.warning = (...args) => warningCalls.push(args);

    await visitCurrentShrine.call(fixture.scene);

    assert.equal(fixture.scene.currentNode.shrine_cooldown_until, cooldownUntil);
    assert.equal(fixture.scene.nodes[0].shrine_cooldown_until, cooldownUntil);
    assert.deepEqual(fixture.cooldowns, [Date.parse(cooldownUntil)]);
    assert.deepEqual(warningCalls, [[
      'Shrine Restoring',
      'Shrine is on cooldown. Return in 5 hour(s).'
    ]]);
    assert.deepEqual(fixture.pendingStates, [true, false]);
  });

  it('keeps the committed local cooldown when the world refresh fails', async () => {
    const fixture = createScene({
      async refreshNodes() {
        throw new Error('World refresh unavailable');
      }
    });
    parchmentToast.success = () => {};
    parchmentToast.error = () => {
      assert.fail('A committed shrine visit must not be reported as failed');
    };

    await visitCurrentShrine.call(fixture.scene);

    assert.ok(Date.parse(fixture.scene.currentNode.shrine_cooldown_until) > Date.now());
    assert.ok(Date.parse(fixture.scene.nodes[0].shrine_cooldown_until) > Date.now());
    assert.deepEqual(fixture.pendingStates, [true, false]);
  });

  it('only updates the visited shrine when the current node changes in flight', async () => {
    let resolveVisit;
    const visitResult = new Promise(resolve => {
      resolveVisit = resolve;
    });
    const fixture = createScene();
    fixture.scene.game.api.visitShrine = () => visitResult;
    parchmentToast.success = () => {};

    const visit = visitCurrentShrine.call(fixture.scene);
    const destinationNode = { id: 99, node_type: 'town', name: 'Crossroads' };
    fixture.scene.currentNode = destinationNode;

    const cooldownUntil = futureIso();
    resolveVisit({
      success: true,
      buff_name: "Ram's Charge",
      shrine_cooldown_until: cooldownUntil,
      isZodiacShrine: true
    });
    await visit;

    assert.equal(fixture.scene.currentNode, destinationNode);
    assert.equal(fixture.scene.currentNode.shrine_cooldown_until, undefined);
    assert.equal(
      fixture.scene.nodes.find(node => node.id === 84).shrine_cooldown_until,
      cooldownUntil
    );
    assert.equal(fixture.rebuiltNodes.length, 0);
    assert.deepEqual(fixture.cooldowns, []);
    assert.equal(
      fixture.stateUpdates.some(([key]) => key === 'currentNode'),
      false
    );
    assert.equal(fixture.getWorldRefreshCount(), 1);
  });

  it('does not start travel while a shrine visit is pending', async () => {
    let travelCalls = 0;
    const scene = {
      shrineVisitPending: true,
      chestClaimPending: false,
      isTraveling: false,
      game: {
        api: {
          travel: async () => {
            travelCalls += 1;
          }
        }
      }
    };

    await travelToNode.call(scene, { id: 99 });

    assert.equal(travelCalls, 0);
  });

  it('does not start a shrine visit while the travel request is pending', async () => {
    let resolveTravel;
    let visitCalls = 0;
    let travelCompletions = 0;
    const travelResult = new Promise(resolve => {
      resolveTravel = resolve;
    });
    const fixture = createScene({
      isNodeDiscovered: () => true,
      onTravelComplete() {
        travelCompletions += 1;
      }
    });
    fixture.scene.game.api.travel = nodeId => {
      assert.equal(nodeId, 99);
      return travelResult;
    };
    fixture.scene.game.api.visitShrine = async () => {
      visitCalls += 1;
    };

    const travel = travelToNode.call(fixture.scene, {
      id: 99,
      node_type: 'town',
      visited: true
    });

    assert.equal(fixture.scene.travelPending, true);
    await visitCurrentShrine.call(fixture.scene);
    assert.equal(visitCalls, 0);

    resolveTravel({
      currentNode: { id: 99, node_type: 'town' },
      pathNodes: []
    });
    await travel;

    assert.equal(fixture.scene.travelPending, false);
    assert.equal(travelCompletions, 1);
  });

  it('ignores a deferred walking completion after the scene exits', async () => {
    let walkingComplete;
    let travelCompletions = 0;
    const fixture = createScene({
      isNodeDiscovered: () => true,
      nodeSpacing: 1,
      mapCharacter: {
        character: {},
        startWalking(_path, onComplete) {
          walkingComplete = onComplete;
        }
      },
      onTravelComplete() {
        travelCompletions += 1;
      }
    });
    fixture.scene.nodeActionMenu.collapse = () => {};
    fixture.scene.game.api.travel = async () => ({
      currentNode: { id: 99, node_type: 'town' },
      pathNodes: [
        { id: 84, x_coord: 0, y_coord: 0 },
        { id: 99, x_coord: 1, y_coord: 0 }
      ]
    });

    await travelToNode.call(fixture.scene, {
      id: 99,
      node_type: 'town',
      visited: true
    });

    assert.equal(typeof walkingComplete, 'function');
    assert.equal(fixture.scene.isTraveling, true);

    exitScene.call(fixture.scene);
    walkingComplete();

    assert.equal(travelCompletions, 0);
    assert.equal(fixture.scene.currentNode.id, 84);
  });

  it('does not let an older collection request overwrite post-visit progress', async () => {
    const resolvers = [];
    const appliedCollections = [];
    const scene = {
      zodiacCollectionRefreshId: 0,
      zodiacCollectionData: null,
      hudPanel: {
        setZodiacCollection(data) {
          appliedCollections.push(data);
        }
      },
      game: {
        state: {
          get: () => ({ id: 7 })
        },
        api: {
          get: () => new Promise(resolve => resolvers.push(resolve))
        }
      }
    };

    const initialRefresh = refreshZodiacCollection.call(scene);
    const postVisitRefresh = refreshZodiacCollection.call(scene);

    resolvers[1]({ totalCollected: 2, collectionComplete: false });
    await postVisitRefresh;
    resolvers[0]({ totalCollected: 1, collectionComplete: false });
    await initialRefresh;

    assert.deepEqual(appliedCollections, [{
      totalCollected: 2,
      collectionComplete: false
    }]);
    assert.equal(scene.zodiacCollectionData.totalCollected, 2);
  });

  it('ignores a collection response from before exit after the scene re-enters', async () => {
    let resolveCollection;
    const appliedCollections = [];
    const collectionResult = new Promise(resolve => {
      resolveCollection = resolve;
    });
    const scene = {
      sceneSessionEpoch: 0,
      zodiacCollectionRefreshId: 0,
      zodiacCollectionData: null,
      hudPanel: {
        destroy() {},
        setZodiacCollection(data) {
          appliedCollections.push(['old', data]);
        }
      },
      game: {
        state: {
          get: () => ({ id: 7 })
        },
        api: {
          get: () => collectionResult
        }
      },
      cleanupWebSocketHandlers() {}
    };

    const oldRefresh = refreshZodiacCollection.call(scene);
    exitScene.call(scene);
    scene.hudPanel = {
      setZodiacCollection(data) {
        appliedCollections.push(['new', data]);
      }
    };
    scene.zodiacCollectionData = { totalCollected: 9 };

    resolveCollection({ totalCollected: 1 });
    await oldRefresh;

    assert.deepEqual(appliedCollections, []);
    assert.deepEqual(scene.zodiacCollectionData, { totalCollected: 9 });
  });

  it('ignores a collection response after the authenticated user changes', async () => {
    let resolveCollection;
    let authUserId = 7;
    const appliedCollections = [];
    const scene = {
      sceneSessionEpoch: 0,
      zodiacCollectionRefreshId: 0,
      zodiacCollectionData: null,
      hudPanel: {
        setZodiacCollection(data) {
          appliedCollections.push(data);
        }
      },
      game: {
        state: {
          get: () => ({ id: authUserId })
        },
        api: {
          get: () => new Promise(resolve => {
            resolveCollection = resolve;
          })
        }
      }
    };

    const oldRefresh = refreshZodiacCollection.call(scene);
    authUserId = 8;
    resolveCollection({ totalCollected: 1 });
    await oldRefresh;

    assert.deepEqual(appliedCollections, []);
    assert.equal(scene.zodiacCollectionData, null);
  });

  it('ignores a shrine response from an exited session and does not clear new pending state', async () => {
    let resolveVisit;
    const visitResult = new Promise(resolve => {
      resolveVisit = resolve;
    });
    const fixture = createScene();
    fixture.scene.game.api.visitShrine = () => visitResult;
    const toastCalls = [];
    parchmentToast.success = (...args) => toastCalls.push(['success', ...args]);
    parchmentToast.warning = (...args) => toastCalls.push(['warning', ...args]);
    parchmentToast.error = (...args) => toastCalls.push(['error', ...args]);

    const oldVisit = visitCurrentShrine.call(fixture.scene);
    exitScene.call(fixture.scene);

    fixture.setAuthUserId(8);
    const reenteredShrine = {
      id: 184,
      node_type: 'shrine',
      zodiac_sign: 'taurus',
      features: []
    };
    const newMenuCalls = [];
    fixture.scene.currentNode = reenteredShrine;
    fixture.scene.nodes = [reenteredShrine];
    fixture.scene.nodeActionMenu = {
      setActionPending(...args) {
        newMenuCalls.push(args);
      }
    };
    fixture.scene.shrineVisitPending = true;

    resolveVisit({
      success: true,
      buff_name: "Ram's Charge",
      crystalAwarded: true,
      shrine_cooldown_until: futureIso()
    });
    await oldVisit;

    assert.equal(fixture.scene.currentNode, reenteredShrine);
    assert.deepEqual(fixture.scene.nodes, [reenteredShrine]);
    assert.equal(fixture.scene.shrineVisitPending, true);
    assert.deepEqual(fixture.stateUpdates, []);
    assert.deepEqual(fixture.playedSounds, []);
    assert.deepEqual(toastCalls, []);
    assert.deepEqual(newMenuCalls, []);
    assert.equal(fixture.getZodiacRefreshCount(), 0);
    assert.equal(fixture.getWorldRefreshCount(), 0);
    assert.equal(fixture.getStaminaRefreshCount(), 0);
  });
});
