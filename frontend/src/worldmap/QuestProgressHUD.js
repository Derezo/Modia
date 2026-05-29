/**
 * QuestProgressHUD - Collapsible panel showing active quest progress
 *
 * Displays in the top-left corner of the world map, showing a summary
 * of active quests with progress bars. Can be collapsed to save space.
 *
 * Visual design:
 * - Daily quests: Single copper star
 * - Weekly quests: Double gold star
 * - Near-complete quests (80%+): Pulse animation on progress bar
 *
 * @see QuestMarkerManager.js - Data source for quest information
 */
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/ParchmentTheme.js';
import { responsive } from '../core/Responsive.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const STYLE_ID = 'quest-progress-hud-styles';

// Quest type badge colors
const QUEST_COLORS = {
  daily: '#b87333',   // Copper
  weekly: '#ffd700'   // Gold
};

export class QuestProgressHUD {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   */
  constructor(options) {
    this.game = options.game;

    /** @type {HTMLElement|null} Main container element */
    this.element = null;

    /** @type {HTMLElement|null} Header element */
    this.headerElement = null;

    /** @type {HTMLElement|null} Quest list container */
    this.listElement = null;

    /** @type {HTMLElement|null} Toggle icon element */
    this.toggleIcon = null;

    /** @type {boolean} Whether the panel is expanded */
    this.isExpanded = true;

    /** @type {boolean} Whether the panel is visible */
    this.isVisible = true;

    /** @type {Array<Object>} Current quests data */
    this.quests = [];

    /** @type {AbortController|null} For event listener cleanup */
    this.abortController = new AbortController();

    /** @type {Function|null} Responsive change unsubscribe */
    this.responsiveUnsubscribe = null;

    this.injectStyles();
    this.createElement();
    this.setupResponsive();
  }

  /**
   * Inject component styles (only once per page)
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Main container */
      .quest-progress-hud {
        position: absolute;
        top: 10px;
        left: 10px;
        min-width: 200px;
        max-width: 280px;
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: 6px;
        box-shadow: ${getParchmentShadow()};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        z-index: 90;
        overflow: hidden;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }

      .quest-progress-hud--hidden {
        opacity: 0;
        pointer-events: none;
        transform: translateY(-10px);
      }

      /* Empty state - hide completely when no quests */
      .quest-progress-hud--empty {
        display: none;
      }

      /* Header section */
      .quest-progress-hud__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: rgba(139, 115, 85, 0.15);
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
        cursor: pointer;
        user-select: none;
        transition: background 0.15s ease;
      }

      .quest-progress-hud__header:hover {
        background: rgba(139, 115, 85, 0.25);
      }

      .quest-progress-hud__title {
        font-size: 13px;
        font-weight: bold;
        color: ${PARCHMENT_COLORS.text.primary};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .quest-progress-hud__count {
        color: ${PARCHMENT_COLORS.text.secondary};
        font-weight: normal;
        margin-left: 4px;
      }

      .quest-progress-hud__toggle {
        font-size: 10px;
        color: ${PARCHMENT_COLORS.text.muted};
        transition: transform 0.25s ease;
      }

      .quest-progress-hud--collapsed .quest-progress-hud__toggle {
        transform: rotate(-90deg);
      }

      /* Quest list */
      .quest-progress-hud__list {
        max-height: 250px;
        overflow-y: auto;
        transition: max-height 0.25s ease, opacity 0.2s ease;
      }

      .quest-progress-hud--collapsed .quest-progress-hud__list {
        max-height: 0;
        opacity: 0;
        overflow: hidden;
      }

      /* Custom scrollbar */
      .quest-progress-hud__list::-webkit-scrollbar {
        width: 6px;
      }

      .quest-progress-hud__list::-webkit-scrollbar-track {
        background: ${PARCHMENT_COLORS.mid};
      }

      .quest-progress-hud__list::-webkit-scrollbar-thumb {
        background: ${PARCHMENT_COLORS.border};
        border-radius: 3px;
      }

      /* Individual quest item */
      .quest-progress-hud__item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(139, 115, 85, 0.2);
      }

      .quest-progress-hud__item:last-child {
        border-bottom: none;
      }

      /* Quest type star badge */
      .quest-progress-hud__badge {
        flex-shrink: 0;
        font-size: 12px;
        line-height: 1;
      }

      .quest-progress-hud__badge--daily {
        color: ${QUEST_COLORS.daily};
        text-shadow: 0 0 4px rgba(184, 115, 51, 0.5);
      }

      .quest-progress-hud__badge--weekly {
        color: ${QUEST_COLORS.weekly};
        text-shadow: 0 0 4px rgba(255, 215, 0, 0.5);
      }

      /* Quest info */
      .quest-progress-hud__info {
        flex: 1;
        min-width: 0;
      }

      .quest-progress-hud__name {
        font-size: 11px;
        font-weight: 600;
        color: ${PARCHMENT_COLORS.text.primary};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 4px;
      }

      /* Progress bar container */
      .quest-progress-hud__progress {
        height: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid rgba(139, 115, 85, 0.3);
      }

      /* Progress bar fill */
      .quest-progress-hud__progress-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s ease;
      }

      .quest-progress-hud__progress-fill--daily {
        background: linear-gradient(to right, ${QUEST_COLORS.daily}, #d4934a);
      }

      .quest-progress-hud__progress-fill--weekly {
        background: linear-gradient(to right, ${QUEST_COLORS.weekly}, #ffe066);
      }

      /* Near-complete pulse animation */
      .quest-progress-hud__progress-fill--pulse {
        animation: quest-pulse 1.5s ease-in-out infinite;
      }

      @keyframes quest-pulse {
        0%, 100% {
          box-shadow: 0 0 4px rgba(255, 215, 0, 0.4);
        }
        50% {
          box-shadow: 0 0 8px rgba(255, 215, 0, 0.8);
        }
      }

      /* Mobile adjustments */
      @media (max-width: 768px) {
        .quest-progress-hud {
          min-width: 180px;
          max-width: 240px;
          top: 8px;
          left: 8px;
        }

        .quest-progress-hud__header {
          padding: 6px 10px;
        }

        .quest-progress-hud__title {
          font-size: 12px;
        }

        .quest-progress-hud__item {
          padding: 6px 10px;
          gap: 6px;
        }

        .quest-progress-hud__name {
          font-size: 10px;
        }

        .quest-progress-hud__progress {
          height: 6px;
        }

        .quest-progress-hud__list {
          max-height: 180px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Create the DOM structure
   */
  createElement() {
    // Main container
    this.element = document.createElement('div');
    this.element.className = 'quest-progress-hud quest-progress-hud--empty';

    // Header (clickable to toggle)
    this.headerElement = document.createElement('div');
    this.headerElement.className = 'quest-progress-hud__header';
    this.headerElement.innerHTML = `
      <span class="quest-progress-hud__title">
        Active Quests<span class="quest-progress-hud__count">(0)</span>
      </span>
      <span class="quest-progress-hud__toggle">\u25BC</span>
    `;

    this.headerElement.addEventListener('click', () => this.toggle(), {
      signal: this.abortController.signal
    });

    this.element.appendChild(this.headerElement);

    // Quest list container
    this.listElement = document.createElement('div');
    this.listElement.className = 'quest-progress-hud__list';
    this.element.appendChild(this.listElement);

    // Store reference to toggle icon
    this.toggleIcon = this.headerElement.querySelector('.quest-progress-hud__toggle');
  }

  /**
   * Setup responsive listener
   */
  setupResponsive() {
    this.responsiveUnsubscribe = responsive.onChange(() => {
      // Styles are already responsive via media queries
      // Could add dynamic adjustments here if needed
    });
  }

  /**
   * Update the HUD with new quest data
   * @param {Array<Object>} quests - Array of quest objects from QuestMarkerManager
   */
  update(quests) {
    this.quests = quests || [];

    // Update count in header
    const countEl = this.headerElement.querySelector('.quest-progress-hud__count');
    if (countEl) {
      countEl.textContent = `(${this.quests.length})`;
    }

    // Toggle empty state
    this.element.classList.toggle('quest-progress-hud--empty', this.quests.length === 0);

    // Rebuild quest list
    this.renderQuestList();
  }

  /**
   * Render the quest list items
   * @private
   */
  renderQuestList() {
    this.listElement.innerHTML = '';

    // Sort: weekly first, then by progress (near-complete at top)
    const sortedQuests = [...this.quests].sort((a, b) => {
      // Weekly quests first
      if (a.type !== b.type) {
        return a.type === 'weekly' ? -1 : 1;
      }
      // Then by progress percent (higher first)
      return b.progressPercent - a.progressPercent;
    });

    for (const quest of sortedQuests) {
      const item = this.createQuestItem(quest);
      this.listElement.appendChild(item);
    }
  }

  /**
   * Create a quest item element
   * @param {Object} quest - Quest data
   * @returns {HTMLElement}
   * @private
   */
  createQuestItem(quest) {
    const item = document.createElement('div');
    item.className = 'quest-progress-hud__item';

    // Star badge
    const badge = document.createElement('span');
    badge.className = `quest-progress-hud__badge quest-progress-hud__badge--${quest.type}`;
    badge.textContent = quest.type === 'weekly' ? '\u2605\u2605' : '\u2605';
    badge.title = quest.type === 'weekly' ? 'Weekly Quest' : 'Daily Quest';
    item.appendChild(badge);

    // Quest info
    const info = document.createElement('div');
    info.className = 'quest-progress-hud__info';

    // Quest name
    const name = document.createElement('div');
    name.className = 'quest-progress-hud__name';
    name.textContent = quest.name;
    name.title = escapeHtml(quest.description || quest.name);
    info.appendChild(name);

    // Progress bar
    const progress = document.createElement('div');
    progress.className = 'quest-progress-hud__progress';

    const fill = document.createElement('div');
    fill.className = `quest-progress-hud__progress-fill quest-progress-hud__progress-fill--${quest.type}`;
    if (quest.nearComplete) {
      fill.classList.add('quest-progress-hud__progress-fill--pulse');
    }
    fill.style.width = `${quest.progressPercent}%`;
    progress.appendChild(fill);

    info.appendChild(progress);
    item.appendChild(info);

    return item;
  }

  /**
   * Toggle expanded/collapsed state
   */
  toggle() {
    this.isExpanded = !this.isExpanded;
    this.element.classList.toggle('quest-progress-hud--collapsed', !this.isExpanded);
  }

  /**
   * Expand the panel
   */
  expand() {
    this.isExpanded = true;
    this.element.classList.remove('quest-progress-hud--collapsed');
  }

  /**
   * Collapse the panel
   */
  collapse() {
    this.isExpanded = false;
    this.element.classList.add('quest-progress-hud--collapsed');
  }

  /**
   * Show the HUD
   */
  show() {
    this.isVisible = true;
    this.element.classList.remove('quest-progress-hud--hidden');
  }

  /**
   * Hide the HUD
   */
  hide() {
    this.isVisible = false;
    this.element.classList.add('quest-progress-hud--hidden');
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }

    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.headerElement = null;
    this.listElement = null;
    this.toggleIcon = null;
    this.quests = [];
  }
}
