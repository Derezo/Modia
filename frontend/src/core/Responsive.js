/**
 * Responsive utility singleton for viewport detection and responsive design
 *
 * Provides breakpoint detection, touch capability detection, and dynamic
 * CSS variable injection for responsive game UI across mobile, tablet, and desktop.
 */

/**
 * Debounce helper function
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export class Responsive {
  /**
   * Breakpoint thresholds in pixels
   * - mobile: viewport width < 600px
   * - tablet: viewport width 600-900px
   * - desktop: viewport width > 900px
   */
  static BREAKPOINTS = {
    mobile: 600,
    tablet: 900,
    desktop: Infinity
  };

  /**
   * CSS variable configurations per breakpoint
   */
  static CSS_CONFIGS = {
    mobile: {
      '--touch-target': '44px',
      '--icon-size-sm': '20px',
      '--icon-size-md': '24px',
      '--icon-size-lg': '32px',
      '--space-xs': '4px',
      '--space-sm': '8px',
      '--space-md': '12px',
      '--space-lg': '16px',
      '--space-xl': '24px',
      '--grid-columns': '3',
      '--grid-item-size': '64px',
      '--font-size-sm': '12px',
      '--font-size-md': '14px',
      '--font-size-lg': '18px',
      '--button-height': '44px',
      '--input-height': '44px'
    },
    tablet: {
      '--touch-target': '40px',
      '--icon-size-sm': '18px',
      '--icon-size-md': '22px',
      '--icon-size-lg': '28px',
      '--space-xs': '4px',
      '--space-sm': '8px',
      '--space-md': '12px',
      '--space-lg': '16px',
      '--space-xl': '24px',
      '--grid-columns': '4',
      '--grid-item-size': '56px',
      '--font-size-sm': '13px',
      '--font-size-md': '15px',
      '--font-size-lg': '18px',
      '--button-height': '40px',
      '--input-height': '40px'
    },
    desktop: {
      '--touch-target': '36px',
      '--icon-size-sm': '16px',
      '--icon-size-md': '20px',
      '--icon-size-lg': '24px',
      '--space-xs': '4px',
      '--space-sm': '8px',
      '--space-md': '12px',
      '--space-lg': '16px',
      '--space-xl': '24px',
      '--grid-columns': '6',
      '--grid-item-size': '48px',
      '--font-size-sm': '12px',
      '--font-size-md': '14px',
      '--font-size-lg': '16px',
      '--button-height': '36px',
      '--input-height': '36px'
    }
  };

  constructor() {
    /** @type {string|null} Current breakpoint: 'mobile', 'tablet', or 'desktop' */
    this.currentBreakpoint = null;

    /** @type {boolean} Whether the device supports touch input */
    this.isTouchDevice = false;

    /** @type {Set<Function>} Set of callback functions for breakpoint changes */
    this.listeners = new Set();

    /** @type {HTMLStyleElement|null} Injected style element for CSS variables */
    this.styleElement = null;

    /** @type {Function|null} Bound resize handler reference for cleanup */
    this._boundResizeHandler = null;

    // Initial detection
    this.detect();
    this.injectCSSVariables();
    this.setupListeners();
  }

  /**
   * Detect current breakpoint and touch capability
   */
  detect() {
    const previousBreakpoint = this.currentBreakpoint;
    const width = window.innerWidth;

    // Determine current breakpoint
    if (width < Responsive.BREAKPOINTS.mobile) {
      this.currentBreakpoint = 'mobile';
    } else if (width < Responsive.BREAKPOINTS.tablet) {
      this.currentBreakpoint = 'tablet';
    } else {
      this.currentBreakpoint = 'desktop';
    }

    // Detect touch capability
    // Check for touch events, pointer events with coarse pointer, or max touch points
    this.isTouchDevice = (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches
    );

    return previousBreakpoint !== this.currentBreakpoint;
  }

  /**
   * Inject or update CSS variables on the :root element
   */
  injectCSSVariables() {
    // Create style element if it doesn't exist
    if (!this.styleElement) {
      this.styleElement = document.createElement('style');
      this.styleElement.id = 'modia-responsive-vars';
      document.head.appendChild(this.styleElement);
    }

    // Get CSS config for current breakpoint
    const config = Responsive.CSS_CONFIGS[this.currentBreakpoint] || Responsive.CSS_CONFIGS.desktop;

    // Build CSS variable declarations
    const cssVars = Object.entries(config)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n');

    // Add touch-specific variable
    const touchVar = `  --is-touch-device: ${this.isTouchDevice ? '1' : '0'};`;

    // Add current breakpoint as CSS variable for debugging/conditional styling
    const breakpointVar = `  --current-breakpoint: '${this.currentBreakpoint}';`;

    // Update style element content
    this.styleElement.textContent = `:root {\n${cssVars}\n${touchVar}\n${breakpointVar}\n}`;
  }

  /**
   * Setup resize event listener with debouncing
   */
  setupListeners() {
    this._boundResizeHandler = debounce(() => {
      const previousBreakpoint = this.currentBreakpoint;
      const breakpointChanged = this.detect();

      if (breakpointChanged) {
        this.injectCSSVariables();
        this.notifyListeners(previousBreakpoint);
      }
    }, 150);

    window.addEventListener('resize', this._boundResizeHandler);

    // Also listen for orientation changes on mobile devices
    window.addEventListener('orientationchange', () => {
      // Small delay to ensure viewport has updated after orientation change
      setTimeout(() => {
        const previousBreakpoint = this.currentBreakpoint;
        const breakpointChanged = this.detect();
        if (breakpointChanged) {
          this.injectCSSVariables();
          this.notifyListeners(previousBreakpoint);
        }
      }, 100);
    });
  }

  /**
   * Notify all registered listeners of a breakpoint change
   * @param {string|null} previousBreakpoint - The breakpoint before the change
   */
  notifyListeners(previousBreakpoint = null) {
    for (const callback of this.listeners) {
      try {
        callback(this.currentBreakpoint, {
          previous: previousBreakpoint,
          isMobile: this.isMobile(),
          isTablet: this.isTablet(),
          isDesktop: this.isDesktop(),
          isTouchDevice: this.isTouchDevice
        });
      } catch (err) {
        console.error('Responsive listener error:', err);
      }
    }
  }

  // ============================================
  // Convenience Methods - Breakpoint Checks
  // ============================================

  /**
   * Check if current breakpoint is mobile
   * @returns {boolean}
   */
  isMobile() {
    return this.currentBreakpoint === 'mobile';
  }

  /**
   * Check if current breakpoint is tablet
   * @returns {boolean}
   */
  isTablet() {
    return this.currentBreakpoint === 'tablet';
  }

  /**
   * Check if current breakpoint is desktop
   * @returns {boolean}
   */
  isDesktop() {
    return this.currentBreakpoint === 'desktop';
  }

  /**
   * Check if touch input is available
   * @returns {boolean}
   */
  hasTouch() {
    return this.isTouchDevice;
  }

  // ============================================
  // Convenience Methods - UI Values
  // ============================================

  /**
   * Whether to show text labels alongside icons
   * On mobile, show icons only to save space
   * @returns {boolean}
   */
  showLabels() {
    return !this.isMobile();
  }

  /**
   * Get optimal grid columns for current breakpoint
   * @returns {number} Number of columns (3 for mobile, 4 for tablet, 6 for desktop)
   */
  getGridColumns() {
    if (this.isMobile()) return 3;
    if (this.isTablet()) return 4;
    return 6;
  }

  /**
   * Get minimum touch target size for current breakpoint
   * Based on accessibility guidelines (44px minimum on touch devices)
   * @returns {number} Touch target size in pixels
   */
  getTouchTarget() {
    if (this.isMobile()) return 44;
    if (this.isTablet()) return 40;
    return 36;
  }

  /**
   * Get item size for grid displays (inventory, formation, etc.)
   * @returns {number} Grid item size in pixels
   */
  getGridItemSize() {
    if (this.isMobile()) return 64;
    if (this.isTablet()) return 56;
    return 48;
  }

  /**
   * Get icon size for a given size category
   * @param {'sm'|'md'|'lg'} size - Size category
   * @returns {number} Icon size in pixels
   */
  getIconSize(size = 'md') {
    const sizes = {
      mobile: { sm: 20, md: 24, lg: 32 },
      tablet: { sm: 18, md: 22, lg: 28 },
      desktop: { sm: 16, md: 20, lg: 24 }
    };
    return sizes[this.currentBreakpoint]?.[size] ?? sizes.desktop[size];
  }

  /**
   * Get canvas font size for a given size category
   * Returns pixel integer suitable for ctx.font strings
   * @param {'sm'|'md'|'lg'} size - Size category
   * @returns {number} Font size in pixels
   */
  getCanvasFontSize(size = 'md') {
    const sizes = {
      mobile: { sm: 12, md: 14, lg: 18 },
      tablet: { sm: 11, md: 13, lg: 16 },
      desktop: { sm: 11, md: 13, lg: 16 }
    };
    return sizes[this.currentBreakpoint]?.[size] ?? sizes.desktop[size];
  }

  /**
   * Get spacing value for a given size category
   * @param {'xs'|'sm'|'md'|'lg'|'xl'} size - Size category
   * @returns {number} Spacing value in pixels
   */
  getSpacing(size = 'md') {
    const sizes = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
    return sizes[size] ?? 12;
  }

  /**
   * Get viewport dimensions
   * @returns {{width: number, height: number}} Viewport dimensions
   */
  getViewport() {
    return {
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  /**
   * Check if viewport is in portrait orientation
   * @returns {boolean}
   */
  isPortrait() {
    return window.innerHeight > window.innerWidth;
  }

  /**
   * Check if viewport is in landscape orientation
   * @returns {boolean}
   */
  isLandscape() {
    return window.innerWidth >= window.innerHeight;
  }

  // ============================================
  // Event Subscription
  // ============================================

  /**
   * Subscribe to breakpoint changes
   * @param {Function} callback - Function called when breakpoint changes
   *   Receives (breakpoint, info) where info contains isMobile, isTablet, isDesktop, isTouchDevice
   * @returns {Function} Unsubscribe function
   */
  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Alias for onChange - matches StateManager pattern
   * @param {Function} callback - Function called when breakpoint changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    return this.onChange(callback);
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Remove event listeners and clean up resources
   * Call this when destroying the game instance
   */
  destroy() {
    if (this._boundResizeHandler) {
      window.removeEventListener('resize', this._boundResizeHandler);
      this._boundResizeHandler = null;
    }

    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }

    this.listeners.clear();
  }

  /**
   * Force a re-detection and update
   * Useful after dynamic DOM changes that might affect viewport
   */
  refresh() {
    const previousBreakpoint = this.currentBreakpoint;
    const breakpointChanged = this.detect();
    this.injectCSSVariables();
    if (breakpointChanged) {
      this.notifyListeners(previousBreakpoint);
    }
  }

  /**
   * Get current responsive state as an object
   * Useful for debugging or passing to components
   * @returns {Object} Current responsive state
   */
  getState() {
    return {
      breakpoint: this.currentBreakpoint,
      isMobile: this.isMobile(),
      isTablet: this.isTablet(),
      isDesktop: this.isDesktop(),
      isTouchDevice: this.isTouchDevice,
      isPortrait: this.isPortrait(),
      viewport: this.getViewport(),
      gridColumns: this.getGridColumns(),
      touchTarget: this.getTouchTarget(),
      gridItemSize: this.getGridItemSize()
    };
  }
}

// ============================================
// Singleton Export
// ============================================

/**
 * Singleton instance of the Responsive utility
 * Import this for responsive features throughout the app:
 *
 * @example
 * import { responsive } from './core/Responsive.js';
 *
 * // Check breakpoint
 * if (responsive.isMobile()) {
 *   // Mobile-specific layout
 * }
 *
 * // Get responsive values
 * const columns = responsive.getGridColumns();
 * const touchSize = responsive.getTouchTarget();
 *
 * // Subscribe to changes
 * const unsubscribe = responsive.onChange((breakpoint, info) => {
 *   console.log('Breakpoint changed to:', breakpoint);
 * });
 *
 * // CSS variables are automatically injected and can be used:
 * // var(--touch-target), var(--grid-columns), var(--space-md), etc.
 */
export const responsive = new Responsive();
