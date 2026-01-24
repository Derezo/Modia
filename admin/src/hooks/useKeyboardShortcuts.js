/**
 * useKeyboardShortcuts - Global keyboard shortcut handling
 *
 * Shortcuts:
 * - 1-6: Switch category tabs (1=tiles, 2=portraits, 3=items, 4=icons, 5=nodes, 6=overlays)
 * - /: Focus search input
 * - g: Generate selected assets (when on category page with selections)
 * - a: Select all visible assets
 * - e: Edit selected prompt (opens detail panel)
 * - Escape: Close detail panel / clear selection
 * - ?: Show keyboard shortcuts help
 */

import { useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Category routes mapped to number keys
 */
const CATEGORY_ROUTES = {
  '1': '/tiles',
  '2': '/portraits',
  '3': '/items',
  '4': '/icons',
  '5': '/nodes',
  '6': '/overlays',
};

/**
 * Check if the active element is an input or editable field
 */
function isInputFocused() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  const tagName = activeElement.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  if (activeElement.isContentEditable) {
    return true;
  }

  return false;
}

/**
 * Custom hook for keyboard shortcut handling
 *
 * @param {Object} handlers - Optional page-specific handlers
 * @param {Function} handlers.onGenerate - Called when 'g' is pressed
 * @param {Function} handlers.onSelectAll - Called when 'a' is pressed
 * @param {Function} handlers.onEdit - Called when 'e' is pressed
 * @param {Function} handlers.onEscape - Called when 'Escape' is pressed
 * @param {Function} handlers.onFocusSearch - Called when '/' is pressed
 */
export function useKeyboardShortcuts(handlers = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const handlersRef = useRef(handlers);

  // Update handlers ref when handlers change
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const handleKeyDown = useCallback((event) => {
    // Don't handle shortcuts when typing in inputs
    if (isInputFocused()) {
      // Exception: Allow Escape to blur input
      if (event.key === 'Escape') {
        document.activeElement?.blur();
      }
      return;
    }

    // Don't handle shortcuts with modifier keys (except for specific combinations)
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const key = event.key;
    const { onGenerate, onSelectAll, onEdit, onEscape, onFocusSearch } = handlersRef.current;

    switch (key) {
      // Number keys 1-6 for category navigation
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6': {
        const route = CATEGORY_ROUTES[key];
        if (route && location.pathname !== route) {
          event.preventDefault();
          navigate(route);
        }
        break;
      }

      // Forward slash for search focus
      case '/': {
        event.preventDefault();
        if (onFocusSearch) {
          onFocusSearch();
        } else {
          // Fallback: try to find search input
          const searchInput = document.querySelector('input[placeholder*="Search"]');
          searchInput?.focus();
        }
        break;
      }

      // 'g' for generate
      case 'g': {
        if (onGenerate) {
          event.preventDefault();
          onGenerate();
        }
        break;
      }

      // 'a' for select all
      case 'a': {
        if (onSelectAll) {
          event.preventDefault();
          onSelectAll();
        }
        break;
      }

      // 'e' for edit
      case 'e': {
        if (onEdit) {
          event.preventDefault();
          onEdit();
        }
        break;
      }

      // Escape for close/clear
      case 'Escape': {
        if (onEscape) {
          event.preventDefault();
          onEscape();
        }
        break;
      }

      // '?' for help (with or without shift)
      case '?': {
        // Could trigger a help modal in the future
        break;
      }

      default:
        break;
    }
  }, [navigate, location.pathname]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * Hook to provide just the navigation shortcuts (for Layout component)
 */
export function useNavigationShortcuts() {
  useKeyboardShortcuts({});
}

export default useKeyboardShortcuts;
