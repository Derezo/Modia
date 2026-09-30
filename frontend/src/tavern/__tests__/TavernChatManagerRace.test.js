import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document ??= { createElement: () => ({}) };

const { TavernChatManager } = await import('../TavernChatManager.js');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function createManager(api) {
  const scene = { game: { api }, activeTab: 'party', activeDMUser: null, uiElement: null };
  const manager = new TavernChatManager(scene);
  const renders = [];
  manager.renderMessages = () => renders.push(manager.messages.map(m => m.id));
  manager.scrollToBottom = () => {};
  return { manager, scene, renders };
}

describe('TavernChatManager tab switch during load', () => {
  it('drops party history when the player switched to Global mid-load', async () => {
    const party = deferred();
    const partyHistory = deferred();
    const { manager, scene } = createManager({
      getMultiplayerParty: () => party.promise,
      getChatHistory: (room) => (room === 'party' ? partyHistory.promise : Promise.resolve({ messages: [{ id: 'g1' }] }))
    });

    const partyLoad = manager.loadChatHistory();
    party.resolve({ party: { id: 9 } });
    await Promise.resolve();

    scene.activeTab = 'global';
    await manager.loadChatHistory();
    assert.deepEqual(manager.messages.map(m => m.id), ['g1']);

    partyHistory.resolve({ messages: [{ id: 'p1' }] });
    await partyLoad;
    assert.deepEqual(manager.messages.map(m => m.id), ['g1']);
  });

  it('does not prepend older party messages to another tab', async () => {
    const party = deferred();
    const { manager, scene } = createManager({
      getMultiplayerParty: () => party.promise,
      getChatHistory: async () => ({ messages: [{ id: 'p0' }] })
    });
    manager.messages = [{ id: 'p1', createdAt: '2026-01-01' }];
    manager.hasMoreMessages = true;

    const loading = manager.loadMoreMessages();
    scene.activeTab = 'dm';
    scene.activeDMUser = { userId: 4 };
    manager.messages = [{ id: 'd1', createdAt: '2026-01-02' }];
    party.resolve({ party: { id: 9 } });
    await loading;

    assert.deepEqual(manager.messages.map(m => m.id), ['d1']);
    assert.equal(manager.loadingMessages, false);
  });

  it('still loads older messages for the view that asked', async () => {
    const { manager } = createManager({
      getMultiplayerParty: async () => ({ party: { id: 9 } }),
      getChatHistory: async () => ({ messages: [{ id: 'p0' }] })
    });
    manager.messages = [{ id: 'p1', createdAt: '2026-01-01' }];
    manager.hasMoreMessages = true;
    await manager.loadMoreMessages();
    assert.deepEqual(manager.messages.map(m => m.id), ['p0', 'p1']);
  });
});
