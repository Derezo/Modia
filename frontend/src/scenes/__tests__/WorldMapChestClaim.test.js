import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let claimCurrentChest;
let travelToNode;
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
  claimCurrentChest = sceneModule.WorldMapScene.prototype.claimCurrentChest;
  travelToNode = sceneModule.WorldMapScene.prototype.travelToNode;
  parchmentToast = toastModule.parchmentToast;
});

after(async () => {
  await server?.close();
});

function createScene(overrides = {}) {
  const pendingStates = [];
  const stateUpdates = [];
  const rebuiltNodes = [];
  let refreshCount = 0;

  const scene = {
    chestClaimPending: false,
    currentNode: { id: 42, node_type: 'chest', chest_claimed: false },
    nodes: [
      { id: 42, node_type: 'chest', chest_claimed: false },
      { id: 99, node_type: 'town' }
    ],
    nodeActionMenu: {
      setActionPending(_feature, pending) {
        pendingStates.push(pending);
      },
      rebuildActions(node) {
        rebuiltNodes.push(node);
      }
    },
    game: {
      api: {
        claimChest: async () => ({
          success: true,
          new_gold_balance: 275,
          message: 'Treasure found'
        })
      },
      state: {
        set(key, value) {
          stateUpdates.push([key, value]);
        }
      }
    },
    async refreshNodes() {
      refreshCount += 1;
    },
    ...overrides
  };

  return {
    scene,
    pendingStates,
    stateUpdates,
    rebuiltNodes,
    getRefreshCount: () => refreshCount
  };
}

describe('WorldMapScene chest claim flow', () => {
  it('guards duplicate submissions, updates gold, and refreshes claimed state', async () => {
    let resolveClaim;
    let claimCount = 0;
    const claimResult = new Promise(resolve => {
      resolveClaim = resolve;
    });
    const fixture = createScene();
    fixture.scene.game.api.claimChest = () => {
      claimCount += 1;
      return claimResult;
    };

    const successCalls = [];
    parchmentToast.success = (...args) => successCalls.push(args);

    const firstClaim = claimCurrentChest.call(fixture.scene);
    await claimCurrentChest.call(fixture.scene);

    assert.equal(claimCount, 1);
    assert.deepEqual(fixture.pendingStates, [true]);

    resolveClaim({
      success: true,
      new_gold_balance: 275,
      message: 'Treasure found'
    });
    await firstClaim;

    assert.deepEqual(fixture.stateUpdates, [
      ['gold', 275],
      ['worldNodes', fixture.scene.nodes],
      ['currentNode', fixture.scene.currentNode]
    ]);
    assert.equal(fixture.scene.currentNode.chest_claimed, true);
    assert.equal(fixture.scene.nodes[0].chest_claimed, true);
    assert.equal(fixture.rebuiltNodes[0].chest_claimed, true);
    assert.equal(fixture.getRefreshCount(), 1);
    assert.deepEqual(fixture.pendingStates, [true, false]);
    assert.deepEqual(successCalls, [['Treasure Collected', 'Treasure found']]);
    assert.equal(fixture.scene.chestClaimPending, false);
  });

  it('keeps the chest locally claimed when the authoritative refresh fails', async () => {
    const fixture = createScene({
      async refreshNodes() {
        throw new Error('Refresh unavailable');
      }
    });
    parchmentToast.success = () => {};
    parchmentToast.error = () => {
      assert.fail('A committed claim must not be reported as failed');
    };

    await claimCurrentChest.call(fixture.scene);

    assert.equal(fixture.scene.currentNode.chest_claimed, true);
    assert.equal(fixture.scene.nodes[0].chest_claimed, true);
    assert.equal(fixture.rebuiltNodes.at(-1).chest_claimed, true);
    assert.deepEqual(fixture.pendingStates, [true, false]);
  });

  it('only marks the captured chest when the current node changes in flight', async () => {
    let resolveClaim;
    let requestedNodeId;
    const claimResult = new Promise(resolve => {
      resolveClaim = resolve;
    });
    const fixture = createScene();
    fixture.scene.game.api.claimChest = nodeId => {
      requestedNodeId = nodeId;
      return claimResult;
    };
    parchmentToast.success = () => {};

    const claim = claimCurrentChest.call(fixture.scene);
    const destinationNode = { id: 99, node_type: 'town', name: 'Crossroads' };
    fixture.scene.currentNode = destinationNode;

    resolveClaim({
      success: true,
      new_gold_balance: 275,
      message: 'Treasure found'
    });
    await claim;

    assert.equal(requestedNodeId, 42);
    assert.equal(fixture.scene.currentNode, destinationNode);
    assert.equal(fixture.scene.currentNode.chest_claimed, undefined);
    assert.equal(fixture.scene.nodes.find(node => node.id === 42).chest_claimed, true);
    assert.equal(fixture.scene.nodes.find(node => node.id === 99).chest_claimed, undefined);
    assert.equal(
      fixture.stateUpdates.some(([key]) => key === 'currentNode'),
      false
    );
    assert.equal(fixture.rebuiltNodes.length, 0);
    assert.equal(fixture.getRefreshCount(), 1);
  });

  it('recovers local claimed state from an idempotent already-claimed response', async () => {
    const fixture = createScene();
    fixture.scene.game.api.claimChest = async () => ({
      success: true,
      already_claimed: true,
      message: 'This treasure was already claimed'
    });

    const successCalls = [];
    parchmentToast.success = (...args) => successCalls.push(args);

    await claimCurrentChest.call(fixture.scene);

    assert.equal(fixture.scene.currentNode.chest_claimed, true);
    assert.equal(fixture.scene.nodes[0].chest_claimed, true);
    assert.deepEqual(successCalls, [[
      'Treasure Already Collected',
      'This treasure was already claimed'
    ]]);
    assert.equal(fixture.getRefreshCount(), 1);
  });

  it('does not start travel while a chest claim is pending', async () => {
    let travelCalls = 0;
    const scene = {
      chestClaimPending: true,
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

  it('shows an error and restores the action when claiming fails', async () => {
    const fixture = createScene();
    fixture.scene.game.api.claimChest = async () => {
      throw new Error('Already claimed');
    };

    const errorCalls = [];
    parchmentToast.error = (...args) => errorCalls.push(args);

    await claimCurrentChest.call(fixture.scene);

    assert.deepEqual(errorCalls, [['Treasure Unavailable', 'Already claimed']]);
    assert.deepEqual(fixture.pendingStates, [true, false]);
    assert.equal(fixture.getRefreshCount(), 0);
    assert.equal(fixture.scene.chestClaimPending, false);
  });
});
