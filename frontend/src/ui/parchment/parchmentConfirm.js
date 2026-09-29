/**
 * parchmentConfirm - Promise-based yes/no dialog in the parchment style.
 *
 * Replaces window.confirm(), which blocks the renderer (the canvas game loop
 * and any automation driving the tab) until it is dismissed.
 *
 * Resolves true on confirm; false on cancel, Escape, overlay click or close.
 *
 * @example
 *   if (!(await parchmentConfirm({ title: 'End Turn', message: 'End your turn?' }))) return;
 *
 * @example
 *   // Using the close handle:
 *   const { promise, close } = parchmentConfirm({ title: 'End Turn', message: 'End your turn?' });
 *   // Later, to close programmatically (e.g., on scene exit):
 *   close();
 */

import { ParchmentModal } from './ParchmentModal.js';
import { escapeHtml } from '../../utils/escapeHtml.js';

/**
 * @param {Object} options
 * @param {string} [options.title='Confirm']
 * @param {string} options.message - Plain text (escaped)
 * @param {string} [options.confirmLabel='Confirm']
 * @param {string} [options.cancelLabel='Cancel']
 * @param {string} [options.confirmVariant='primary'] - ParchmentButton variant
 * @returns {{promise: Promise<boolean>, close: function}} Object with promise and close method
 */
export function parchmentConfirm({
  title = 'Confirm',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary'
} = {}) {
  let settled = false;
  let resolvePromise;

  const settle = (value) => {
    if (settled) return;
    settled = true;
    resolvePromise(value);
  };

  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const modal = new ParchmentModal({
    title,
    content: `<p style="margin: 0; line-height: 1.5;">${escapeHtml(message)}</p>`,
    size: 'sm',
    closable: true,
    closeOnOverlay: true,
    closeOnEscape: true,
    actions: [
      {
        label: cancelLabel,
        variant: 'secondary',
        onClick: () => { settle(false); modal.close(); }
      },
      {
        label: confirmLabel,
        variant: confirmVariant,
        onClick: () => { settle(true); modal.close(); }
      }
    ],
    // Any other dismissal (Escape, overlay, close button) is a cancel
    onClose: () => settle(false)
  });

  modal.open();

  /**
   * Close the dialog programmatically. The promise will resolve to false.
   */
  const close = () => {
    if (!settled) {
      modal.close();
    }
  };

  // Return both the promise and the close handle.
  // The promise is also thenable, so `await parchmentConfirm(...)` still works
  // because `await` calls `.then()` on the returned object.
  const result = {
    promise,
    close,
    // Make the object thenable for backward compatibility with `await`
    then: (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected),
    catch: (onRejected) => promise.catch(onRejected),
    finally: (onFinally) => promise.finally(onFinally)
  };

  return result;
}

export default parchmentConfirm;
