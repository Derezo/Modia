/**
 * Icon - Responsive icon component with optional labels
 *
 * Renders an icon image with optional text label that responds to viewport size.
 * Labels are hidden on mobile to save space.
 *
 * Usage:
 *   // As DOM element
 *   const icon = new Icon('menu', 'formation', { label: 'Formation' });
 *   container.appendChild(icon.render());
 *
 *   // Update icon state
 *   icon.setActive(true);
 *   icon.setDisabled(false);
 *
 *   // As inline HTML string
 *   button.innerHTML = Icon.html('menu', 'formation', { label: 'Formation', size: 'md' });
 */

import { responsive } from '../core/Responsive.js';
import { iconLoader } from '../core/IconLoader.js';

/**
 * Size mappings for different breakpoints
 * Maps size category to pixel values per viewport size
 */
const SIZE_MAP = {
  sm: { mobile: 20, tablet: 18, desktop: 16 },
  md: { mobile: 24, tablet: 22, desktop: 20 },
  lg: { mobile: 32, tablet: 28, desktop: 24 },
  xl: { mobile: 48, tablet: 40, desktop: 32 }
};

export class Icon {
  /**
   * Static size map for external reference
   */
  static SIZE_MAP = SIZE_MAP;

  /**
   * @param {string} category - Icon category (e.g., 'menu', 'action', 'status')
   * @param {string} name - Icon name (e.g., 'formation', 'attack', 'health')
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.label] - Text label to display alongside icon
   * @param {'sm'|'md'|'lg'|'xl'} [options.size='md'] - Size category
   * @param {string} [options.className] - Additional CSS class names
   * @param {boolean} [options.active=false] - Whether icon is in active state
   * @param {boolean} [options.disabled=false] - Whether icon is disabled
   * @param {string} [options.title] - Tooltip title (defaults to label)
   * @param {string} [options.color] - Icon tint color (CSS color value)
   * @param {'row'|'column'} [options.layout='row'] - Label layout direction
   */
  constructor(category, name, options = {}) {
    this.category = category;
    this.name = name;
    this.label = options.label || null;
    this.size = options.size || 'md';
    this.className = options.className || '';
    this.active = options.active || false;
    this.disabled = options.disabled || false;
    this.title = options.title || options.label || '';
    this.color = options.color || null;
    this.layout = options.layout || 'row';

    /** @type {HTMLElement|null} */
    this.element = null;

    /** @type {HTMLImageElement|null} */
    this.imgElement = null;

    /** @type {HTMLElement|null} */
    this.labelElement = null;

    /** @type {Function|null} */
    this.unsubscribe = null;

    // Inject styles once
    Icon.injectStyles();
  }

  /**
   * Get pixel size for current breakpoint
   * @returns {number} Size in pixels
   */
  getPixelSize() {
    const sizeConfig = SIZE_MAP[this.size] || SIZE_MAP.md;
    const breakpoint = responsive.currentBreakpoint || 'desktop';
    return sizeConfig[breakpoint] || sizeConfig.desktop;
  }

  /**
   * Render the icon component
   * @returns {HTMLElement} The rendered element
   */
  render() {
    // Create container
    this.element = document.createElement('span');
    this.element.className = this.buildClassName();
    if (this.title) {
      this.element.setAttribute('title', this.title);
    }

    // Create image element
    this.imgElement = document.createElement('img');
    this.imgElement.className = 'modia-icon__img';
    // Empty alt when label exists to avoid duplication if image fails to load
    this.imgElement.alt = this.label ? '' : `${this.category}-${this.name}`;
    this.imgElement.draggable = false;
    this.updateImageSource();
    this.element.appendChild(this.imgElement);

    // Create label if provided
    if (this.label) {
      this.labelElement = document.createElement('span');
      this.labelElement.className = 'modia-icon__label';
      this.labelElement.textContent = this.label;
      this.updateLabelVisibility();
      this.element.appendChild(this.labelElement);
    }

    // Apply color tint if specified
    if (this.color) {
      this.element.style.setProperty('--icon-color', this.color);
    }

    // Subscribe to responsive changes
    this.unsubscribe = responsive.onChange(() => {
      this.updateImageSource();
      this.updateLabelVisibility();
    });

    return this.element;
  }

  /**
   * Build CSS class name string
   * @returns {string} Class names
   */
  buildClassName() {
    const classes = ['modia-icon', `modia-icon--${this.size}`];

    if (this.layout === 'column') {
      classes.push('modia-icon--column');
    }

    if (this.active) {
      classes.push('modia-icon--active');
    }

    if (this.disabled) {
      classes.push('modia-icon--disabled');
    }

    if (this.color) {
      classes.push('modia-icon--tinted');
    }

    if (this.className) {
      classes.push(this.className);
    }

    return classes.join(' ');
  }

  /**
   * Update image source based on current size
   */
  updateImageSource() {
    if (!this.imgElement) return;

    const pixelSize = this.getPixelSize();
    const path = iconLoader.getIconPath(this.category, this.name, pixelSize);

    this.imgElement.src = path;
    this.imgElement.style.width = `${pixelSize}px`;
    this.imgElement.style.height = `${pixelSize}px`;
  }

  /**
   * Update label visibility based on breakpoint
   */
  updateLabelVisibility() {
    if (!this.labelElement) return;

    // Hide labels on mobile
    this.labelElement.style.display = responsive.showLabels() ? '' : 'none';
  }

  /**
   * Set active state
   * @param {boolean} active - Whether icon is active
   */
  setActive(active) {
    this.active = active;
    if (this.element) {
      this.element.classList.toggle('modia-icon--active', active);
    }
  }

  /**
   * Set disabled state
   * @param {boolean} disabled - Whether icon is disabled
   */
  setDisabled(disabled) {
    this.disabled = disabled;
    if (this.element) {
      this.element.classList.toggle('modia-icon--disabled', disabled);
    }
  }

  /**
   * Update the label text
   * @param {string} label - New label text
   */
  setLabel(label) {
    this.label = label;
    if (this.labelElement) {
      this.labelElement.textContent = label;
    }
  }

  /**
   * Set icon color tint
   * @param {string|null} color - CSS color value or null to remove
   */
  setColor(color) {
    this.color = color;
    if (this.element) {
      if (color) {
        this.element.style.setProperty('--icon-color', color);
        this.element.classList.add('modia-icon--tinted');
      } else {
        this.element.style.removeProperty('--icon-color');
        this.element.classList.remove('modia-icon--tinted');
      }
    }
  }

  /**
   * Change the icon
   * @param {string} category - New category
   * @param {string} name - New name
   */
  setIcon(category, name) {
    this.category = category;
    this.name = name;
    this.updateImageSource();
    if (this.imgElement) {
      this.imgElement.alt = this.label || `${category}-${name}`;
    }
  }

  /**
   * Cleanup and remove from DOM
   */
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.imgElement = null;
    this.labelElement = null;
  }

  /**
   * Generate HTML string for inline use
   * Note: This is a static method that does not respond to breakpoint changes.
   * For responsive icons, use the instance-based render() method.
   *
   * @param {string} category - Icon category
   * @param {string} name - Icon name
   * @param {Object} [options={}] - Configuration options
   * @returns {string} HTML string
   */
  static html(category, name, options = {}) {
    const {
      label = null,
      size = 'md',
      className = '',
      active = false,
      disabled = false,
      title = label || '',
      color = null,
      layout = 'row'
    } = options;

    // Get current breakpoint size
    const sizeConfig = SIZE_MAP[size] || SIZE_MAP.md;
    const breakpoint = responsive.currentBreakpoint || 'desktop';
    const pixelSize = sizeConfig[breakpoint] || sizeConfig.desktop;

    // Build class names
    const classes = ['modia-icon', `modia-icon--${size}`];
    if (layout === 'column') classes.push('modia-icon--column');
    if (active) classes.push('modia-icon--active');
    if (disabled) classes.push('modia-icon--disabled');
    if (color) classes.push('modia-icon--tinted');
    if (className) classes.push(className);

    // Build inline style for color
    const style = color ? `style="--icon-color: ${color}"` : '';

    // Build label HTML
    const showLabels = responsive.showLabels();
    const labelHtml = label && showLabels
      ? `<span class="modia-icon__label">${escapeHtml(label)}</span>`
      : '';

    // Build image path using IconLoader for consistent normalization
    const imgPath = iconLoader.getIconPath(category, name, pixelSize);

    // Use descriptive alt for screen readers, but avoid label duplication when image fails
    const altText = label ? '' : `${category}-${name}`;

    return `<span class="${classes.join(' ')}" ${style} title="${escapeHtml(title)}">
      <img class="modia-icon__img" src="${imgPath}" alt="${escapeHtml(altText)}"
           style="width: ${pixelSize}px; height: ${pixelSize}px;" draggable="false">
      ${labelHtml}
    </span>`;
  }

  /**
   * Inject component styles (once)
   */
  static injectStyles() {
    if (document.getElementById('modia-icon-styles')) return;

    const style = document.createElement('style');
    style.id = 'modia-icon-styles';
    style.textContent = `
      /* Icon Component Base */
      .modia-icon {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        vertical-align: middle;
        user-select: none;
        transition: opacity 0.15s ease;
      }

      .modia-icon--column {
        flex-direction: column;
        gap: 4px;
      }

      /* Image */
      .modia-icon__img {
        display: block;
        image-rendering: pixelated;
        image-rendering: -moz-crisp-edges;
        image-rendering: crisp-edges;
        flex-shrink: 0;
      }

      /* Color tint using filter */
      .modia-icon--tinted .modia-icon__img {
        filter: drop-shadow(0 0 0 var(--icon-color, currentColor));
      }

      /* Label */
      .modia-icon__label {
        font-family: 'Georgia', 'Times New Roman', serif;
        font-size: var(--font-size-sm, 12px);
        color: inherit;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Size variants - font sizes for labels */
      .modia-icon--sm .modia-icon__label {
        font-size: 11px;
      }

      .modia-icon--md .modia-icon__label {
        font-size: 12px;
      }

      .modia-icon--lg .modia-icon__label {
        font-size: 14px;
      }

      .modia-icon--xl .modia-icon__label {
        font-size: 16px;
      }

      /* States */
      .modia-icon--active {
        color: #4a9eff;
      }

      .modia-icon--active .modia-icon__img {
        filter: brightness(1.2) saturate(1.3);
      }

      .modia-icon--disabled {
        opacity: 0.4;
        pointer-events: none;
      }

      .modia-icon--disabled .modia-icon__img {
        filter: grayscale(100%);
      }

      /* Hover state (for buttons/interactive elements) */
      button .modia-icon:hover,
      a .modia-icon:hover,
      .modia-icon.clickable:hover {
        opacity: 0.8;
      }

      button .modia-icon:active,
      a .modia-icon:active,
      .modia-icon.clickable:active {
        transform: scale(0.95);
      }

      /* Loading state */
      .modia-icon__img[src=""] {
        opacity: 0;
      }

      /* Error fallback */
      .modia-icon__img.error {
        opacity: 0.3;
        filter: grayscale(100%);
      }
    `;
    document.head.appendChild(style);
  }
}

import { escapeHtml } from '../utils/escapeHtml.js';

export default Icon;
