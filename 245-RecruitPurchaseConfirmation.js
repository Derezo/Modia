import { ParchmentModal } from '../../ui/parchment/ParchmentModal.js';

/**
 * Create the themed confirmation used when hiring a Guild Hall recruit.
 * Dynamic recruit text is assigned with textContent so server-provided names
 * are never interpreted as modal markup.
 */
export function createRecruitPurchaseConfirmation({ recruit, onConfirm, onClose }) {
  const content = document.createElement('p');
  content.textContent = `Recruit ${recruit.name} for ${recruit.price}g?`;

  const modal = new ParchmentModal({
    title: 'Confirm Recruitment',
    content,
    size: 'sm',
    closable: true,
    closeOnOverlay: true,
    closeOnEscape: true,
    actions: [
      {
        label: 'Cancel',
        variant: 'secondary',
        onClick: () => modal.close()
      },
      {
        label: `Recruit (${recruit.price}g)`,
        variant: 'primary',
        onClick: () => onConfirm?.(modal)
      }
    ],
    onClose: () => onClose?.(modal)
  });

  return modal;
}
