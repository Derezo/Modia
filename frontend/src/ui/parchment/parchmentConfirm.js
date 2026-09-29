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
 * @returns {Promise<boolean>}
 */
export function parchmentConfirm({
  title = 'Confirm',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary'
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

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
  });
}

export default parchmentConfirm;
