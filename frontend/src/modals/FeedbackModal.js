/**
 * FeedbackModal - Submit enhancement requests, bug reports, or abuse reports
 *
 * Allows players to provide feedback from within the game with automatic
 * capture of game context (scene, node, battle state).
 */

import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/index.js';

const P = PARCHMENT_COLORS;

export class FeedbackModal {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   * @param {Function} options.onClose - Callback when modal closes
   */
  constructor(options) {
    this.game = options.game;
    this.onClose = options.onClose;

    this.element = null;
    this.abortController = null;
    this.isSubmitting = false;

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('feedback-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'feedback-modal-styles';
    style.textContent = `
      .feedback-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        font-family: Georgia, 'Times New Roman', serif;
      }

      .feedback-modal {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder(3)};
        border-radius: 12px;
        box-shadow: ${getParchmentShadow()}, 0 0 40px rgba(0, 0, 0, 0.5);
        max-width: 480px;
        width: 90%;
        max-height: 85vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .feedback-header {
        padding: 16px 20px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        text-align: center;
      }

      .feedback-title {
        margin: 0 0 4px 0;
        color: ${P.accent.gold};
        font-size: 20px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .feedback-subtitle {
        color: ${P.text.secondary};
        font-size: 13px;
        font-style: italic;
      }

      .feedback-content {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }

      .feedback-field {
        margin-bottom: 16px;
      }

      .feedback-label {
        display: block;
        margin-bottom: 6px;
        color: ${P.text.primary};
        font-size: 14px;
        font-weight: bold;
      }

      .feedback-select,
      .feedback-input,
      .feedback-textarea {
        width: 100%;
        padding: 10px 12px;
        border: ${getParchmentBorder()};
        border-radius: 6px;
        background: ${P.light};
        color: ${P.text.primary};
        font-family: inherit;
        font-size: 14px;
        box-sizing: border-box;
      }

      .feedback-select:focus,
      .feedback-input:focus,
      .feedback-textarea:focus {
        outline: none;
        border-color: ${P.accent.copper};
        box-shadow: 0 0 4px rgba(139, 115, 85, 0.3);
      }

      .feedback-textarea {
        min-height: 120px;
        resize: vertical;
      }

      .feedback-char-count {
        text-align: right;
        font-size: 11px;
        color: ${P.text.secondary};
        margin-top: 4px;
      }

      .feedback-char-count--warning {
        color: ${P.accent.copper};
      }

      .feedback-char-count--error {
        color: #c44;
      }

      .feedback-abuse-field {
        display: none;
      }

      .feedback-abuse-field--visible {
        display: block;
      }

      .feedback-footer {
        padding: 12px 16px;
        border-top: ${getParchmentBorder()};
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .feedback-btn {
        padding: 8px 20px;
        border: ${getParchmentBorder()};
        border-radius: 6px;
        font-family: inherit;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .feedback-btn--secondary {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        color: ${P.text.primary};
      }

      .feedback-btn--secondary:hover {
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
      }

      .feedback-btn--primary {
        background: linear-gradient(to bottom, ${P.accent.gold}, ${P.accent.copper});
        color: ${P.dark};
      }

      .feedback-btn--primary:hover:not(:disabled) {
        filter: brightness(1.1);
      }

      .feedback-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      @media (max-width: 480px) {
        .feedback-modal {
          width: 95%;
          max-height: 90vh;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Gather current game context for the feedback
   */
  getGameContext() {
    const context = {};

    try {
      // Current scene
      if (this.game.currentScene) {
        context.scene = this.game.currentScene.constructor.name;
      }

      // State manager data
      const state = this.game.stateManager;
      if (state) {
        // Current node
        const currentNode = state.get('currentNode');
        if (currentNode) {
          context.nodeId = currentNode.id;
          context.nodeType = currentNode.node_type;
          context.nodeRegion = currentNode.region_id;
        }

        // Current character
        const activeChar = state.get('activeCharacter');
        if (activeChar) {
          context.characterId = activeChar.id;
          context.characterLevel = activeChar.level;
        }

        // Battle state
        const battle = state.get('currentBattle');
        if (battle) {
          context.inBattle = true;
          context.battleId = battle.id;
          context.battleTurn = battle.turn_number;
        }
      }
    } catch (e) {
      // Don't fail if context gathering has issues
      context.contextError = e.message;
    }

    return context;
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'feedback-overlay';

    const modal = document.createElement('div');
    modal.className = 'feedback-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'feedback-header';
    header.innerHTML = `
      <h2 class="feedback-title">Send Feedback</h2>
      <p class="feedback-subtitle">Help us improve Modia</p>
    `;
    modal.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'feedback-content';

    // Feedback type selector
    const typeField = document.createElement('div');
    typeField.className = 'feedback-field';
    typeField.innerHTML = `
      <label class="feedback-label">Feedback Type</label>
      <select class="feedback-select" id="feedback-type">
        <option value="enhancement">Enhancement Request</option>
        <option value="bug">Bug Report</option>
        <option value="abuse">Report Abuse</option>
      </select>
    `;
    content.appendChild(typeField);

    // Title input
    const titleField = document.createElement('div');
    titleField.className = 'feedback-field';
    titleField.innerHTML = `
      <label class="feedback-label">Title</label>
      <input type="text" class="feedback-input" id="feedback-title"
             placeholder="Brief summary of your feedback"
             maxlength="200" />
      <div class="feedback-char-count" id="title-char-count">0 / 200</div>
    `;
    content.appendChild(titleField);

    // Description textarea
    const descField = document.createElement('div');
    descField.className = 'feedback-field';
    descField.innerHTML = `
      <label class="feedback-label">Description</label>
      <textarea class="feedback-textarea" id="feedback-description"
                placeholder="Please provide details..."
                maxlength="2000"></textarea>
      <div class="feedback-char-count" id="desc-char-count">0 / 2000</div>
    `;
    content.appendChild(descField);

    // Reported character (for abuse reports)
    const abuseField = document.createElement('div');
    abuseField.className = 'feedback-field feedback-abuse-field';
    abuseField.id = 'abuse-field';
    abuseField.innerHTML = `
      <label class="feedback-label">Reported Character Name</label>
      <input type="text" class="feedback-input" id="feedback-reported-char"
             placeholder="Name of the player you are reporting" />
    `;
    content.appendChild(abuseField);

    modal.appendChild(content);

    // Footer with buttons
    const footer = document.createElement('div');
    footer.className = 'feedback-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'feedback-btn feedback-btn--secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close(), { signal: this.abortController.signal });

    const submitBtn = document.createElement('button');
    submitBtn.className = 'feedback-btn feedback-btn--primary';
    submitBtn.textContent = 'Submit';
    submitBtn.id = 'feedback-submit';
    submitBtn.addEventListener('click', () => this.submit(), { signal: this.abortController.signal });

    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);
    modal.appendChild(footer);

    this.element.appendChild(modal);

    // Close on overlay click
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    }, { signal: this.abortController.signal });

    // Setup event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    const typeSelect = this.element.querySelector('#feedback-type');
    const titleInput = this.element.querySelector('#feedback-title');
    const descTextarea = this.element.querySelector('#feedback-description');
    const abuseField = this.element.querySelector('#abuse-field');
    const titleCharCount = this.element.querySelector('#title-char-count');
    const descCharCount = this.element.querySelector('#desc-char-count');

    // Toggle abuse field visibility
    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'abuse') {
        abuseField.classList.add('feedback-abuse-field--visible');
      } else {
        abuseField.classList.remove('feedback-abuse-field--visible');
      }
    }, { signal: this.abortController.signal });

    // Character count for title
    titleInput.addEventListener('input', () => {
      const len = titleInput.value.length;
      titleCharCount.textContent = `${len} / 200`;
      titleCharCount.className = 'feedback-char-count';
      if (len > 180) titleCharCount.classList.add('feedback-char-count--warning');
      if (len >= 200) titleCharCount.classList.add('feedback-char-count--error');
    }, { signal: this.abortController.signal });

    // Character count for description
    descTextarea.addEventListener('input', () => {
      const len = descTextarea.value.length;
      descCharCount.textContent = `${len} / 2000`;
      descCharCount.className = 'feedback-char-count';
      if (len > 1800) descCharCount.classList.add('feedback-char-count--warning');
      if (len >= 2000) descCharCount.classList.add('feedback-char-count--error');
    }, { signal: this.abortController.signal });
  }

  async submit() {
    if (this.isSubmitting) return;

    const feedbackType = this.element.querySelector('#feedback-type').value;
    const title = this.element.querySelector('#feedback-title').value.trim();
    const description = this.element.querySelector('#feedback-description').value.trim();
    const reportedCharacterName = this.element.querySelector('#feedback-reported-char')?.value.trim();

    // Validation
    if (!title) {
      parchmentToast('Please enter a title', 'error');
      return;
    }
    if (!description) {
      parchmentToast('Please enter a description', 'error');
      return;
    }

    // Get current character ID if available
    const activeChar = this.game.stateManager?.get('activeCharacter');
    const characterId = activeChar?.id;

    // Gather game context
    const gameContext = this.getGameContext();

    const submitBtn = this.element.querySelector('#feedback-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    this.isSubmitting = true;

    try {
      await this.game.api.submitFeedback({
        feedbackType,
        title,
        description,
        characterId,
        gameContext,
        ...(feedbackType === 'abuse' && reportedCharacterName && { reportedCharacterName })
      });

      parchmentToast('Feedback submitted successfully!', 'success');
      this.close();
    } catch (error) {
      parchmentToast(error.message || 'Failed to submit feedback', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
      this.isSubmitting = false;
    }
  }

  show() {
    this.abortController = new AbortController();
    this.createElement();
    this.game.uiOverlay.appendChild(this.element);

    // Focus title input
    setTimeout(() => {
      this.element.querySelector('#feedback-title')?.focus();
    }, 100);
  }

  close() {
    if (this.onClose) {
      this.onClose();
    }
  }

  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
