import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionReplacedPrompt, SESSION_REPLACED_EVENT } from '../SessionReplacedPrompt.js';

function fakeSocket({ withReconnectNow = false } = {}) {
  const handlers = new Map();
  const socket = {
    connects: [],
    manualReconnects: [],
    sessionReplaced: true,
    reconnectAttempts: 5,
    on(type, handler) {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    emit(type, payload) {
      handlers.get(type)?.(payload);
    },
    hasHandler(type) {
      return handlers.has(type);
    },
    connect(token) {
      this.connects.push(token);
    }
  };
  if (withReconnectNow) {
    socket.reconnectNow = (token) => socket.manualReconnects.push(token);
  }
  return socket;
}

function fakeModalFactory() {
  const created = [];
  const createModal = (options) => {
    const modal = {
      options,
      opened: 0,
      closed: 0,
      open() { this.opened++; },
      close() { this.closed++; },
      click(label) { options.actions.find(a => a.label === label).onClick(); }
    };
    created.push(modal);
    return modal;
  };
  return { created, createModal };
}

describe('SessionReplacedPrompt', () => {
  it('subscribes to the session_replaced event and shows one prompt, never reconnecting by itself', () => {
    const socket = fakeSocket();
    const { created, createModal } = fakeModalFactory();
    new SessionReplacedPrompt({ socket, getToken: () => 'tok', createModal });

    assert.equal(SESSION_REPLACED_EVENT, 'session_replaced');
    socket.emit('session_replaced', {});
    socket.emit('session_replaced', {});

    assert.equal(created.length, 1, 'a repeated event must not stack prompts');
    assert.equal(created[0].opened, 1);
    assert.equal(created[0].options.title, 'Signed in elsewhere');
    assert.deepEqual(socket.connects, [], 'showing the prompt must not reconnect');
  });

  it('"Stay disconnected" closes the prompt without reconnecting, and a later event can show it again', () => {
    const socket = fakeSocket();
    const { created, createModal } = fakeModalFactory();
    new SessionReplacedPrompt({ socket, getToken: () => 'tok', createModal });

    socket.emit('session_replaced');
    created[0].click('Stay disconnected');
    assert.equal(created[0].closed, 1);
    assert.deepEqual(socket.connects, []);

    socket.emit('session_replaced');
    assert.equal(created.length, 2);
  });

  it('"Reconnect here" uses the socket manual reconnect path with the current token', () => {
    const socket = fakeSocket({ withReconnectNow: true });
    const { created, createModal } = fakeModalFactory();
    let token = 'old';
    new SessionReplacedPrompt({ socket, getToken: () => token, createModal });

    socket.emit('session_replaced');
    token = 'refreshed';
    created[0].click('Reconnect here');

    assert.deepEqual(socket.manualReconnects, ['refreshed']);
    assert.deepEqual(socket.connects, []);
    assert.equal(created[0].closed, 1);
  });

  it('falls back to clearing the replaced flag and connecting when reconnectNow is absent', () => {
    const socket = fakeSocket();
    const { created, createModal } = fakeModalFactory();
    new SessionReplacedPrompt({ socket, getToken: () => 'tok', createModal });

    socket.emit('session_replaced');
    created[0].click('Reconnect here');

    assert.equal(socket.sessionReplaced, false);
    assert.equal(socket.reconnectAttempts, 0);
    assert.deepEqual(socket.connects, ['tok']);
  });

  it('does not reconnect after logout (no token)', () => {
    const socket = fakeSocket({ withReconnectNow: true });
    const { created, createModal } = fakeModalFactory();
    new SessionReplacedPrompt({ socket, getToken: () => null, createModal });

    socket.emit('session_replaced');
    created[0].click('Reconnect here');
    assert.deepEqual(socket.manualReconnects, []);
    assert.deepEqual(socket.connects, []);
  });

  it('destroy() unsubscribes and closes an open prompt', () => {
    const socket = fakeSocket();
    const { created, createModal } = fakeModalFactory();
    const prompt = new SessionReplacedPrompt({ socket, getToken: () => 'tok', createModal });

    socket.emit('session_replaced');
    prompt.destroy();
    assert.equal(created[0].closed, 1);
    assert.equal(socket.hasHandler('session_replaced'), false);
  });
});
