import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

class FakeHTMLElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this.textContent = '';
  }
}

globalThis.HTMLElement = FakeHTMLElement;

const elementsById = new Map();
globalThis.document = {
  createElement(tagName) { return new FakeHTMLElement(tagName); },
  getElementById(id) { return elementsById.get(id) || null; },
  head: {
    appendChild(child) {
      if (child.id) elementsById.set(child.id, child);
      return child;
    }
  }
};

const { createRecruitPurchaseConfirmation } = await import(
  '../recruitment/RecruitPurchaseConfirmation.js'
);
const { ParchmentModal } = await import('../../ui/parchment/ParchmentModal.js');

describe('Guild Hall recruit confirmation', () => {
  it('uses the themed modal and keeps dynamic recruit names as text', () => {
    const modal = createRecruitPurchaseConfirmation({
      recruit: { name: '<script>Ellis</script>', price: 40 }
    });

    assert.ok(modal instanceof ParchmentModal);
    assert.equal(modal.options.title, 'Confirm Recruitment');
    assert.equal(modal.options.size, 'sm');
    assert.equal(modal.options.content.textContent, 'Recruit <script>Ellis</script> for 40g?');
    assert.deepEqual(modal.options.actions.map(action => action.label), ['Cancel', 'Recruit (40g)']);
  });

  it('does not confirm until the themed Recruit action is selected', async () => {
    let nativeConfirmCalls = 0;
    globalThis.confirm = () => {
      nativeConfirmCalls += 1;
      return true;
    };
    let confirmedWith = null;
    const modal = createRecruitPurchaseConfirmation({
      recruit: { name: 'Ellis', price: 40 },
      onConfirm: async selectedModal => {
        confirmedWith = selectedModal;
      }
    });

    try {
      assert.equal(confirmedWith, null);
      await modal.options.actions[1].onClick();

      assert.equal(confirmedWith, modal);
      assert.equal(nativeConfirmCalls, 0);
    } finally {
      delete globalThis.confirm;
    }
  });

  it('closes on Cancel and forwards modal closure to the scene', () => {
    let closeCalls = 0;
    let closedWith = null;
    const modal = createRecruitPurchaseConfirmation({
      recruit: { name: 'Ellis', price: 40 },
      onClose: selectedModal => { closedWith = selectedModal; }
    });
    modal.close = () => { closeCalls += 1; };

    modal.options.actions[0].onClick();
    modal.options.onClose();

    assert.equal(closeCalls, 1);
    assert.equal(closedWith, modal);
  });
});
