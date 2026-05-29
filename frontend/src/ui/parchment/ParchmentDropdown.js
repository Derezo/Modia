/**
 * ParchmentDropdown - Medieval-styled dropdown/select component with parchment aesthetic
 *
 * Features:
 * - Options with value, label, disabled, and optional icon
 * - Optional label above dropdown
 * - Placeholder text when nothing selected
 * - Click outside to close
 * - Keyboard support (Escape to close)
 * - Clean event cleanup with AbortController
 *
 * Usage:
 *   const dropdown = new ParchmentDropdown({
 *     options: [
 *       { value: 'opt1', label: 'Option 1' },
 *       { value: 'opt2', label: 'Option 2', disabled: true },
 *       { value: 'opt3', label: 'Option 3', icon: '<svg>...</svg>' }
 *     ],
 *     selected: 'opt1',
 *     placeholder: 'Select...',
 *     label: 'Choose Item',
 *     onChange: (value, option) => console.log(value)
 *   });
 *   container.appendChild(dropdown.element);
 *   dropdown.destroy(); // Clean up when done
 */

import { PARCHMENT_COLORS } from './ParchmentTheme.js';
import { escapeHtml } from '../../utils/escapeHtml.js';

const STYLE_ID = 'parchment-dropdown-styles';

export default class ParchmentDropdown {
  /**
   * @param {Object} options
   * @param {Array<{value: string, label: string, disabled?: boolean, icon?: string}>} options.options - Dropdown options
   * @param {string} options.selected - Initially selected value
   * @param {string} options.placeholder - Placeholder text when nothing selected (default: 'Select...')
   * @param {string} options.label - Optional label above dropdown
   * @param {boolean} options.disabled - Whether dropdown is disabled (default: false)
   * @param {Function} options.onChange - Change callback (receives value, option)
   */
  constructor(options = {}) {
    this.options = options.options || [];
    this.selected = options.selected ?? null;
    this.placeholder = options.placeholder || 'Select...';
    this.label = options.label || null;
    this.disabled = options.disabled || false;
    this.onChange = options.onChange || null;

    this.isOpen = false;
    this.element = null;
    this.triggerElement = null;
    this.menuElement = null;
    this.labelElement = null;
    this.abortController = null;

    this.createElement();
    this.addStyles();
    this.bindEvents();
  }

  /**
   * Create the dropdown DOM structure
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'parchment-dropdown';
    this.updateElement();
  }

  /**
   * Update element structure and classes
   */
  updateElement() {
    const selectedOption = this.options.find(opt => opt.value === this.selected);
    const displayValue = selectedOption ? selectedOption.label : this.placeholder;
    const hasSelection = !!selectedOption;

    let html = '';

    // Label
    if (this.label) {
      html += `<label class="parchment-dropdown-label">${escapeHtml(this.label)}</label>`;
    }

    // Trigger button
    html += `
      <button type="button" class="parchment-dropdown-trigger${this.disabled ? ' parchment-dropdown-trigger--disabled' : ''}${this.isOpen ? ' parchment-dropdown-trigger--open' : ''}" ${this.disabled ? 'disabled' : ''}>
        <span class="parchment-dropdown-value${!hasSelection ? ' parchment-dropdown-value--placeholder' : ''}">
          ${selectedOption?.icon ? `<span class="parchment-dropdown-value-icon">${selectedOption.icon}</span>` : ''}
          ${escapeHtml(displayValue)}
        </span>
        <span class="parchment-dropdown-chevron${this.isOpen ? ' parchment-dropdown-chevron--open' : ''}">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </span>
      </button>
    `;

    // Dropdown menu
    html += `<div class="parchment-dropdown-menu${this.isOpen ? ' parchment-dropdown-menu--open' : ''}">`;

    for (const option of this.options) {
      const isSelected = option.value === this.selected;
      const isDisabled = option.disabled;

      let optionClasses = 'parchment-dropdown-option';
      if (isSelected) optionClasses += ' parchment-dropdown-option--selected';
      if (isDisabled) optionClasses += ' parchment-dropdown-option--disabled';

      html += `
        <div class="${optionClasses}" data-value="${escapeHtml(option.value)}" ${isDisabled ? 'data-disabled="true"' : ''}>
          ${option.icon ? `<span class="parchment-dropdown-option-icon">${option.icon}</span>` : ''}
          <span class="parchment-dropdown-option-label">${escapeHtml(option.label)}</span>
          ${isSelected ? '<span class="parchment-dropdown-option-check">&#10003;</span>' : ''}
        </div>
      `;
    }

    html += '</div>';

    this.element.innerHTML = html;

    // Store references
    this.triggerElement = this.element.querySelector('.parchment-dropdown-trigger');
    this.menuElement = this.element.querySelector('.parchment-dropdown-menu');
    this.labelElement = this.element.querySelector('.parchment-dropdown-label');

    // Update wrapper classes
    this.element.classList.toggle('parchment-dropdown--open', this.isOpen);
    this.element.classList.toggle('parchment-dropdown--disabled', this.disabled);
  }

  /**
   * Add component styles (only once per page)
   */
  addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Parchment Dropdown Wrapper */
      .parchment-dropdown {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: 'Georgia', 'Times New Roman', serif;
      }

      /* Label */
      .parchment-dropdown-label {
        font-size: 13px;
        font-weight: bold;
        color: ${PARCHMENT_COLORS.text.primary};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .parchment-dropdown--disabled .parchment-dropdown-label {
        opacity: 0.6;
      }

      /* Trigger Button */
      .parchment-dropdown-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 10px 12px;
        font-family: 'Georgia', 'Times New Roman', serif;
        font-size: 14px;
        color: ${PARCHMENT_COLORS.text.primary};
        background: #e8dcc8;
        border: 2px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
        outline: none;
        text-align: left;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.3),
          0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .parchment-dropdown-trigger:hover:not(.parchment-dropdown-trigger--disabled) {
        border-color: #7a6345;
      }

      .parchment-dropdown-trigger:focus:not(.parchment-dropdown-trigger--disabled) {
        border-color: ${PARCHMENT_COLORS.borderDark};
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.3),
          0 1px 2px rgba(0, 0, 0, 0.1),
          0 0 0 3px rgba(107, 83, 68, 0.2);
      }

      .parchment-dropdown-trigger--open {
        border-color: ${PARCHMENT_COLORS.borderDark};
      }

      .parchment-dropdown-trigger--disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background: #d8cbb8;
      }

      /* Value Display */
      .parchment-dropdown-value {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .parchment-dropdown-value--placeholder {
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }

      .parchment-dropdown-value-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .parchment-dropdown-value-icon svg {
        width: 16px;
        height: 16px;
      }

      /* Chevron Icon */
      .parchment-dropdown-chevron {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: ${PARCHMENT_COLORS.text.secondary};
        transition: transform 0.2s ease;
      }

      .parchment-dropdown-chevron--open {
        transform: rotate(180deg);
      }

      /* Dropdown Menu */
      .parchment-dropdown-menu {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        margin-top: 4px;
        padding: 4px 0;
        background: #e8dcc8;
        border: 2px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.25),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
        z-index: 1000;
        max-height: 240px;
        overflow-y: auto;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-4px);
        transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;
      }

      .parchment-dropdown-menu--open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      /* Custom Scrollbar for Menu */
      .parchment-dropdown-menu::-webkit-scrollbar {
        width: 8px;
      }

      .parchment-dropdown-menu::-webkit-scrollbar-track {
        background: ${PARCHMENT_COLORS.dark};
        border-radius: 4px;
      }

      .parchment-dropdown-menu::-webkit-scrollbar-thumb {
        background: ${PARCHMENT_COLORS.border};
        border-radius: 4px;
      }

      .parchment-dropdown-menu::-webkit-scrollbar-thumb:hover {
        background: ${PARCHMENT_COLORS.borderDark};
      }

      /* Dropdown Option */
      .parchment-dropdown-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        color: ${PARCHMENT_COLORS.text.primary};
        cursor: pointer;
        transition: background 0.1s ease;
      }

      .parchment-dropdown-option:hover:not(.parchment-dropdown-option--disabled) {
        background: ${PARCHMENT_COLORS.dark};
      }

      .parchment-dropdown-option--selected {
        background: ${PARCHMENT_COLORS.mid};
        font-weight: bold;
      }

      .parchment-dropdown-option--selected:hover:not(.parchment-dropdown-option--disabled) {
        background: ${PARCHMENT_COLORS.dark};
      }

      .parchment-dropdown-option--disabled {
        color: ${PARCHMENT_COLORS.text.muted};
        cursor: not-allowed;
        opacity: 0.6;
      }

      /* Option Icon */
      .parchment-dropdown-option-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .parchment-dropdown-option-icon svg {
        width: 16px;
        height: 16px;
      }

      /* Option Label */
      .parchment-dropdown-option-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Checkmark */
      .parchment-dropdown-option-check {
        flex-shrink: 0;
        color: ${PARCHMENT_COLORS.state.success};
        font-size: 14px;
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Trigger click to toggle menu
    this.triggerElement.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.disabled) {
        this.toggle();
      }
    }, { signal });

    // Option click to select
    this.menuElement.addEventListener('click', (e) => {
      const optionEl = e.target.closest('.parchment-dropdown-option');
      if (optionEl && optionEl.dataset.disabled !== 'true') {
        const value = optionEl.dataset.value;
        this.select(value);
      }
    }, { signal });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.element.contains(e.target)) {
        this.close();
      }
    }, { signal });

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') {
        this.close();
        this.triggerElement.focus();
      }
    }, { signal });
  }

  /**
   * Toggle dropdown open/closed
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Open the dropdown menu
   */
  open() {
    if (this.disabled || this.isOpen) return;
    this.isOpen = true;
    this.updateElement();
    this.rebindInternalEvents();
  }

  /**
   * Close the dropdown menu
   */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.updateElement();
    this.rebindInternalEvents();
  }

  /**
   * Rebind events to new DOM elements after updateElement
   */
  rebindInternalEvents() {
    // Store the existing document-level listeners
    const existingController = this.abortController;

    // Create new controller for internal element events only
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Trigger click to toggle menu
    this.triggerElement.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.disabled) {
        this.toggle();
      }
    }, { signal });

    // Option click to select
    this.menuElement.addEventListener('click', (e) => {
      const optionEl = e.target.closest('.parchment-dropdown-option');
      if (optionEl && optionEl.dataset.disabled !== 'true') {
        const value = optionEl.dataset.value;
        this.select(value);
      }
    }, { signal });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.element.contains(e.target)) {
        this.close();
      }
    }, { signal });

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') {
        this.close();
        this.triggerElement.focus();
      }
    }, { signal });

    // Abort old controller
    if (existingController) {
      existingController.abort();
    }
  }

  /**
   * Select an option by value
   * @param {string} value
   */
  select(value) {
    const option = this.options.find(opt => opt.value === value);
    if (!option || option.disabled) return;

    const previousValue = this.selected;
    this.selected = value;
    this.close();

    if (previousValue !== value && this.onChange) {
      this.onChange(value, option);
    }
  }

  /**
   * Get current selected value
   * @returns {string|null}
   */
  getValue() {
    return this.selected;
  }

  /**
   * Get current selected option object
   * @returns {Object|null}
   */
  getSelectedOption() {
    return this.options.find(opt => opt.value === this.selected) || null;
  }

  /**
   * Set selected value programmatically
   * @param {string} value
   * @param {boolean} triggerChange - Whether to trigger onChange callback (default: false)
   */
  setValue(value, triggerChange = false) {
    const option = this.options.find(opt => opt.value === value);
    if (!option) return;

    const previousValue = this.selected;
    this.selected = value;
    this.updateElement();
    this.rebindInternalEvents();

    if (triggerChange && previousValue !== value && this.onChange) {
      this.onChange(value, option);
    }
  }

  /**
   * Update dropdown options
   * @param {Array} options - New options array
   */
  setOptions(options) {
    this.options = options || [];
    // Clear selection if current value no longer exists
    if (this.selected && !this.options.find(opt => opt.value === this.selected)) {
      this.selected = null;
    }
    this.updateElement();
    this.rebindInternalEvents();
  }

  /**
   * Set disabled state
   * @param {boolean} disabled
   */
  setDisabled(disabled) {
    this.disabled = disabled;
    if (disabled && this.isOpen) {
      this.close();
    } else {
      this.updateElement();
      this.rebindInternalEvents();
    }
  }

  /**
   * Set placeholder text
   * @param {string} placeholder
   */
  setPlaceholder(placeholder) {
    this.placeholder = placeholder;
    this.updateElement();
    this.rebindInternalEvents();
  }

  /**
   * Update dropdown properties
   * @param {Object} options - Properties to update
   */
  update(options = {}) {
    if (options.options !== undefined) this.options = options.options;
    if (options.selected !== undefined) this.selected = options.selected;
    if (options.placeholder !== undefined) this.placeholder = options.placeholder;
    if (options.label !== undefined) this.label = options.label;
    if (options.disabled !== undefined) this.disabled = options.disabled;
    if (options.onChange !== undefined) this.onChange = options.onChange;

    this.updateElement();
    this.rebindInternalEvents();
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
    this.triggerElement = null;
    this.menuElement = null;
    this.labelElement = null;
    this.onChange = null;
  }
}

export { ParchmentDropdown };
