/**
 * ParchmentInput - Medieval-styled text input component with parchment aesthetic
 *
 * Features:
 * - Supports text, number, and password input types
 * - Optional label above input
 * - Error state with message display
 * - Focus state with subtle glow
 * - Clean event cleanup with AbortController
 *
 * Usage:
 *   const input = new ParchmentInput({
 *     type: 'text',
 *     label: 'Character Name',
 *     placeholder: 'Enter name...',
 *     onChange: (value) => console.log(value)
 *   });
 *   container.appendChild(input.element);
 *   const value = input.getValue();
 *   input.destroy(); // Clean up when done
 */

import { escapeHtml } from '../../utils/escapeHtml.js';

const COLORS = {
  light: '#d4c4a8',
  mid: '#c9b899',
  dark: '#bfae8a',
  border: '#8b7355',
  borderDark: '#6b5344',
  background: '#e8dcc8',
  text: {
    primary: '#2d2418',
    secondary: '#5a4a3a',
    placeholder: '#8a7a6a'
  },
  state: {
    error: '#8b4444',
    errorBg: '#f8e8e8'
  }
};

export default class ParchmentInput {
  /**
   * @param {Object} options
   * @param {string} options.type - 'text' | 'number' | 'password' (default: 'text')
   * @param {string} options.placeholder - Placeholder text
   * @param {string} options.value - Initial value
   * @param {string} options.label - Optional label above input
   * @param {string} options.error - Optional error message
   * @param {string} options.name - Optional input name attribute
   * @param {boolean} options.required - Whether input is required (default: false)
   * @param {boolean} options.disabled - Whether input is disabled (default: false)
   * @param {number} options.min - Minimum value for number type
   * @param {number} options.max - Maximum value for number type
   * @param {number} options.step - Step value for number type
   * @param {number} options.maxLength - Maximum character length
   * @param {Function} options.onChange - Change callback (receives value)
   * @param {Function} options.onInput - Input callback (receives value)
   * @param {Function} options.onFocus - Focus callback
   * @param {Function} options.onBlur - Blur callback
   */
  constructor(options = {}) {
    this.type = options.type || 'text';
    this.placeholder = options.placeholder || '';
    this.value = options.value || '';
    this.label = options.label || null;
    this.error = options.error || null;
    this.name = options.name || null;
    this.required = options.required || false;
    this.disabled = options.disabled || false;
    this.min = options.min;
    this.max = options.max;
    this.step = options.step;
    this.maxLength = options.maxLength;

    this.onChange = options.onChange || null;
    this.onInput = options.onInput || null;
    this.onFocus = options.onFocus || null;
    this.onBlur = options.onBlur || null;

    this.element = null;
    this.inputElement = null;
    this.labelElement = null;
    this.errorElement = null;
    this.abortController = null;

    this.createElement();
    this.addStyles();
    this.bindEvents();
  }

  /**
   * Create the input DOM structure
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'parchment-input-wrapper';
    this.updateElement();
  }

  /**
   * Update element structure and classes
   */
  updateElement() {
    let html = '';

    // Label
    if (this.label) {
      html += `<label class="parchment-input__label">${escapeHtml(this.label)}${this.required ? ' <span class="parchment-input__required">*</span>' : ''}</label>`;
    }

    // Input container (for potential future additions like icons)
    html += '<div class="parchment-input__container">';

    // Build input attributes
    const attrs = [
      `type="${this.type}"`,
      `class="parchment-input${this.error ? ' parchment-input--error' : ''}${this.disabled ? ' parchment-input--disabled' : ''}"`,
      `placeholder="${escapeHtml(this.placeholder)}"`,
      `value="${escapeHtml(this.value)}"`
    ];

    if (this.name) attrs.push(`name="${escapeHtml(this.name)}"`);
    if (this.required) attrs.push('required');
    if (this.disabled) attrs.push('disabled');
    if (this.min !== undefined) attrs.push(`min="${this.min}"`);
    if (this.max !== undefined) attrs.push(`max="${this.max}"`);
    if (this.step !== undefined) attrs.push(`step="${this.step}"`);
    if (this.maxLength !== undefined) attrs.push(`maxlength="${this.maxLength}"`);

    html += `<input ${attrs.join(' ')}>`;
    html += '</div>';

    // Error message
    if (this.error) {
      html += `<div class="parchment-input__error">${escapeHtml(this.error)}</div>`;
    }

    this.element.innerHTML = html;

    // Store references
    this.inputElement = this.element.querySelector('.parchment-input');
    this.labelElement = this.element.querySelector('.parchment-input__label');
    this.errorElement = this.element.querySelector('.parchment-input__error');

    // Update wrapper class for error state
    this.element.classList.toggle('parchment-input-wrapper--error', !!this.error);
    this.element.classList.toggle('parchment-input-wrapper--disabled', this.disabled);

    // Rebind events after DOM update
    if (this.abortController) {
      this.abortController.abort();
    }
    this.bindEvents();
  }

  /**
   * Add component styles (only once per page)
   */
  addStyles() {
    if (document.getElementById('parchment-input-styles')) return;

    const style = document.createElement('style');
    style.id = 'parchment-input-styles';
    style.textContent = `
      /* Parchment Input Wrapper */
      .parchment-input-wrapper {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: 'Georgia', 'Times New Roman', serif;
      }

      /* Label */
      .parchment-input__label {
        font-size: 13px;
        font-weight: bold;
        color: ${COLORS.text.primary};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .parchment-input__required {
        color: ${COLORS.state.error};
      }

      /* Input Container */
      .parchment-input__container {
        position: relative;
        display: flex;
      }

      /* Input Base */
      .parchment-input {
        width: 100%;
        padding: 10px 12px;
        font-family: 'Georgia', 'Times New Roman', serif;
        font-size: 14px;
        color: ${COLORS.text.primary};
        background: ${COLORS.background};
        border: 2px solid ${COLORS.border};
        border-radius: 4px;
        box-shadow:
          inset 0 1px 3px rgba(0, 0, 0, 0.1),
          0 1px 0 rgba(255, 255, 255, 0.3);
        transition: all 0.15s ease;
        outline: none;
      }

      .parchment-input::placeholder {
        color: ${COLORS.text.placeholder};
        font-style: italic;
      }

      /* Focus State */
      .parchment-input:focus {
        border-color: ${COLORS.borderDark};
        box-shadow:
          inset 0 1px 3px rgba(0, 0, 0, 0.1),
          0 1px 0 rgba(255, 255, 255, 0.3),
          0 0 0 3px rgba(107, 83, 68, 0.2);
      }

      /* Hover State */
      .parchment-input:hover:not(:focus):not(.parchment-input--disabled):not(.parchment-input--error) {
        border-color: #7a6345;
      }

      /* Error State */
      .parchment-input--error {
        border-color: ${COLORS.state.error};
        background: ${COLORS.state.errorBg};
      }

      .parchment-input--error:focus {
        border-color: ${COLORS.state.error};
        box-shadow:
          inset 0 1px 3px rgba(0, 0, 0, 0.1),
          0 1px 0 rgba(255, 255, 255, 0.3),
          0 0 0 3px rgba(139, 68, 68, 0.2);
      }

      /* Error Message */
      .parchment-input__error {
        font-size: 12px;
        color: ${COLORS.state.error};
        margin-top: 2px;
      }

      /* Disabled State */
      .parchment-input--disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background: #d8cbb8;
      }

      .parchment-input-wrapper--disabled .parchment-input__label {
        opacity: 0.6;
      }

      /* Number input - hide spinner in some browsers */
      .parchment-input[type="number"] {
        -moz-appearance: textfield;
      }

      .parchment-input[type="number"]::-webkit-outer-spin-button,
      .parchment-input[type="number"]::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    if (!this.inputElement) return;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Change event (fires on blur after value change)
    this.inputElement.addEventListener('change', (e) => {
      this.value = e.target.value;
      if (this.onChange) {
        this.onChange(this.value, e);
      }
    }, { signal });

    // Input event (fires on every keystroke)
    this.inputElement.addEventListener('input', (e) => {
      this.value = e.target.value;
      if (this.onInput) {
        this.onInput(this.value, e);
      }
    }, { signal });

    // Focus event
    this.inputElement.addEventListener('focus', (e) => {
      if (this.onFocus) {
        this.onFocus(e);
      }
    }, { signal });

    // Blur event
    this.inputElement.addEventListener('blur', (e) => {
      if (this.onBlur) {
        this.onBlur(e);
      }
    }, { signal });
  }

  /**
   * Get current input value
   * @returns {string}
   */
  getValue() {
    return this.inputElement ? this.inputElement.value : this.value;
  }

  /**
   * Set input value
   * @param {string} value
   */
  setValue(value) {
    this.value = value;
    if (this.inputElement) {
      this.inputElement.value = value;
    }
  }

  /**
   * Set error message (null to clear)
   * @param {string|null} error
   */
  setError(error) {
    this.error = error;
    this.updateElement();
  }

  /**
   * Clear error message
   */
  clearError() {
    this.setError(null);
  }

  /**
   * Set disabled state
   * @param {boolean} disabled
   */
  setDisabled(disabled) {
    this.disabled = disabled;
    this.updateElement();
  }

  /**
   * Focus the input
   */
  focus() {
    if (this.inputElement) {
      this.inputElement.focus();
    }
  }

  /**
   * Blur the input
   */
  blur() {
    if (this.inputElement) {
      this.inputElement.blur();
    }
  }

  /**
   * Select all text in the input
   */
  select() {
    if (this.inputElement) {
      this.inputElement.select();
    }
  }

  /**
   * Update input properties
   * @param {Object} options - Properties to update
   */
  update(options = {}) {
    if (options.type !== undefined) this.type = options.type;
    if (options.placeholder !== undefined) this.placeholder = options.placeholder;
    if (options.value !== undefined) this.value = options.value;
    if (options.label !== undefined) this.label = options.label;
    if (options.error !== undefined) this.error = options.error;
    if (options.name !== undefined) this.name = options.name;
    if (options.required !== undefined) this.required = options.required;
    if (options.disabled !== undefined) this.disabled = options.disabled;
    if (options.min !== undefined) this.min = options.min;
    if (options.max !== undefined) this.max = options.max;
    if (options.step !== undefined) this.step = options.step;
    if (options.maxLength !== undefined) this.maxLength = options.maxLength;
    if (options.onChange !== undefined) this.onChange = options.onChange;
    if (options.onInput !== undefined) this.onInput = options.onInput;
    if (options.onFocus !== undefined) this.onFocus = options.onFocus;
    if (options.onBlur !== undefined) this.onBlur = options.onBlur;

    this.updateElement();
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.inputElement = null;
    this.labelElement = null;
    this.errorElement = null;
    this.onChange = null;
    this.onInput = null;
    this.onFocus = null;
    this.onBlur = null;
  }
}

export { ParchmentInput, COLORS };
