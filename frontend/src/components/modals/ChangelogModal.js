/**
 * ChangelogModal - Display application changelog in a parchment-styled modal
 *
 * Features:
 * - Fetches and parses CHANGELOG.md from server
 * - Renders version headers prominently with styled dividers
 * - Displays bullet points as styled list items
 * - Scrollable content area for long changelogs
 * - Handles fetch errors gracefully
 *
 * Usage:
 *   const modal = new ChangelogModal();
 *   modal.open();
 */

import { ParchmentModal } from '../../ui/parchment/ParchmentModal.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  getParchmentScrollbarCSS
} from '../../ui/parchment/ParchmentTheme.js';

const STYLE_ID = 'changelog-modal-styles';

export class ChangelogModal {
  constructor() {
    this.modal = null;
    this.injectStyles();
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
      .changelog-container {
        max-height: 400px;
        overflow-y: auto;
        padding-right: ${PARCHMENT_SPACING.sm};
      }

      ${getParchmentScrollbarCSS('.changelog-container')}

      .changelog-description {
        color: ${PARCHMENT_COLORS.text.muted};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-style: italic;
        margin: 0 0 ${PARCHMENT_SPACING.md} 0;
        line-height: ${PARCHMENT_TYPOGRAPHY.lineHeight};
      }

      .changelog-version {
        color: ${PARCHMENT_COLORS.text.primary};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin: ${PARCHMENT_SPACING.lg} 0 ${PARCHMENT_SPACING.sm} 0;
        padding-bottom: ${PARCHMENT_SPACING.xs};
        border-bottom: 1px solid ${PARCHMENT_COLORS.borderLight};
      }

      .changelog-version:first-child {
        margin-top: 0;
      }

      .changelog-list {
        margin: 0 0 ${PARCHMENT_SPACING.sm} 0;
        padding-left: 20px;
        list-style-type: disc;
      }

      .changelog-item {
        color: ${PARCHMENT_COLORS.text.secondary};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        margin-bottom: ${PARCHMENT_SPACING.xs};
        line-height: ${PARCHMENT_TYPOGRAPHY.lineHeight};
      }

      .changelog-error {
        color: ${PARCHMENT_COLORS.state.error};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        text-align: center;
        padding: ${PARCHMENT_SPACING.lg};
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Open the changelog modal
   */
  async open() {
    const content = await this.fetchChangelog();
    const parsed = this.parseMarkdown(content);

    this.modal = new ParchmentModal({
      title: 'Changelog',
      content: parsed,
      size: 'md',
      closable: true,
      closeOnOverlay: true,
      closeOnEscape: true,
      actions: [
        {
          label: 'Close',
          variant: 'secondary',
          onClick: () => this.close()
        }
      ],
      onClose: () => {
        this.modal = null;
      }
    });

    this.modal.open();
  }

  /**
   * Fetch the changelog from the server
   * @returns {Promise<string>} Changelog markdown content
   */
  async fetchChangelog() {
    try {
      const response = await fetch('/CHANGELOG.md');
      if (!response.ok) {
        throw new Error(`Failed to fetch changelog: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      console.error('Error fetching changelog:', error);
      return '# Changelog\n\nUnable to load changelog.';
    }
  }

  /**
   * Parse markdown content into DOM elements
   * @param {string} md - Markdown content
   * @returns {HTMLElement} Container element with parsed content
   */
  parseMarkdown(md) {
    const container = document.createElement('div');
    container.className = 'changelog-container';

    const lines = md.split('\n');
    let currentList = null;

    for (const line of lines) {
      // Skip main title (# Changelog) - it's shown in modal header
      if (line.startsWith('# ')) {
        continue;
      }

      // Version header (## X.Y.Z or ## [X.Y.Z])
      if (line.startsWith('## ')) {
        // Close previous list if open
        if (currentList) {
          container.appendChild(currentList);
          currentList = null;
        }

        const versionText = line.replace('## ', '').trim();
        // Remove brackets if present (some changelogs use ## [1.0.0])
        const version = versionText.replace(/^\[|\]$/g, '');

        const header = document.createElement('h3');
        header.className = 'changelog-version';
        header.textContent = `Version ${version}`;
        container.appendChild(header);
        continue;
      }

      // Section header (### Added, ### Fixed, etc.)
      if (line.startsWith('### ')) {
        // Close previous list if open
        if (currentList) {
          container.appendChild(currentList);
          currentList = null;
        }

        const sectionText = line.replace('### ', '').trim();
        const section = document.createElement('h4');
        section.className = 'changelog-version';
        section.style.fontSize = PARCHMENT_TYPOGRAPHY.sizes.base;
        section.style.marginTop = PARCHMENT_SPACING.sm;
        section.textContent = sectionText;
        container.appendChild(section);
        continue;
      }

      // Bullet point (- item or * item)
      if (line.match(/^[-*]\s+/)) {
        if (!currentList) {
          currentList = document.createElement('ul');
          currentList.className = 'changelog-list';
        }

        const item = document.createElement('li');
        item.className = 'changelog-item';
        // Remove leading dash/asterisk and whitespace
        item.textContent = line.replace(/^[-*]\s+/, '').trim();
        currentList.appendChild(item);
        continue;
      }

      // Description/subtitle line (not empty, not a header, not a bullet)
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#') && !trimmedLine.match(/^[-*]\s+/)) {
        // Close previous list if open
        if (currentList) {
          container.appendChild(currentList);
          currentList = null;
        }

        const para = document.createElement('p');
        para.className = 'changelog-description';
        para.textContent = trimmedLine;
        container.appendChild(para);
      }
    }

    // Append any remaining list
    if (currentList) {
      container.appendChild(currentList);
    }

    // If no content was parsed, show a message
    if (container.children.length === 0) {
      const error = document.createElement('p');
      error.className = 'changelog-error';
      error.textContent = 'No changelog entries found.';
      container.appendChild(error);
    }

    return container;
  }

  /**
   * Close the modal
   */
  close() {
    if (this.modal) {
      this.modal.close();
      this.modal = null;
    }
  }

  /**
   * Check if the modal is currently open
   * @returns {boolean}
   */
  isOpen() {
    return this.modal !== null && this.modal.isVisible();
  }
}

export default ChangelogModal;
