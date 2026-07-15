import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  installImageFallbackHandler,
  showImageFallback
} from '../imageFallback.js';

function createFallbackImage() {
  const addedClasses = [];
  return {
    style: { display: 'block' },
    dataset: {
      fallbackDisplay: 'inline-flex',
      fallbackErrorClass: 'has-image-error'
    },
    hasAttribute(name) { return name === 'data-image-fallback'; },
    nextElementSibling: { style: { display: 'none' } },
    parentElement: { classList: { add(value) { addedClasses.push(value); } } },
    addedClasses
  };
}

describe('CSP-safe image fallbacks', () => {
  it('reveals the adjacent fallback and marks the parent', () => {
    const image = createFallbackImage();

    assert.equal(showImageFallback(image), true);
    assert.equal(image.style.display, 'none');
    assert.equal(image.nextElementSibling.style.display, 'inline-flex');
    assert.deepEqual(image.addedClasses, ['has-image-error']);
  });

  it('installs one captured error listener per document', () => {
    let listener = null;
    let capture = null;
    const targetDocument = {
      addEventListener(type, handler, options) {
        assert.equal(type, 'error');
        listener = handler;
        capture = options;
      }
    };

    assert.equal(installImageFallbackHandler(targetDocument), true);
    assert.equal(installImageFallbackHandler(targetDocument), false);
    assert.equal(capture, true);

    const image = createFallbackImage();
    listener({ target: image });
    assert.equal(image.style.display, 'none');
    assert.equal(image.nextElementSibling.style.display, 'inline-flex');
  });

  it('ignores images that did not opt in', () => {
    const image = createFallbackImage();
    image.hasAttribute = () => false;

    assert.equal(showImageFallback(image), false);
    assert.equal(image.style.display, 'block');
  });
});

