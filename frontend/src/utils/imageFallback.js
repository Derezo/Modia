/**
 * CSP-safe image fallback handling for HTML-string renderers.
 *
 * Image `error` events do not bubble, but they can be observed during the
 * capture phase. A single document listener therefore covers markup inserted
 * later without requiring blocked inline `onerror` attributes.
 */

const installedDocuments = new WeakSet();

export function showImageFallback(image) {
  if (!image?.hasAttribute?.('data-image-fallback')) return false;

  image.style.display = 'none';

  const fallback = image.nextElementSibling;
  if (fallback?.style) {
    fallback.style.display = image.dataset?.fallbackDisplay || 'flex';
  }

  const errorClass = image.dataset?.fallbackErrorClass;
  if (errorClass) image.parentElement?.classList?.add(errorClass);

  return true;
}

export function installImageFallbackHandler(targetDocument = globalThis.document) {
  if (!targetDocument?.addEventListener || installedDocuments.has(targetDocument)) {
    return false;
  }

  targetDocument.addEventListener('error', event => {
    showImageFallback(event.target);
  }, true);
  installedDocuments.add(targetDocument);
  return true;
}

