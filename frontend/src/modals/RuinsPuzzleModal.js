/**
 * RuinsPuzzleModal - Sliding tile puzzle for ruins nodes
 *
 * A classic sliding puzzle where players rearrange tiles to form
 * an ancient symbol. Supports 3x3, 4x4, and 5x5 grid sizes.
 */

import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const P = PARCHMENT_COLORS;

export class RuinsPuzzleModal {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   * @param {Function} options.onClose - Callback when modal closes
   * @param {Function} options.onSolve - Callback when puzzle is solved
   */
  constructor(options) {
    this.game = options.game;
    this.onClose = options.onClose;
    this.onSolve = options.onSolve;

    this.element = null;
    this.abortController = null;

    // Puzzle state
    this.nodeId = null;
    this.gridSize = 3;
    this.tiles = [];
    this.moveCount = 0;
    this.startTime = null;
    this.timerInterval = null;
    this.isCompleted = false;
    this.isSolving = false;

    // Puzzle data from API
    this.puzzleData = null;

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('ruins-puzzle-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'ruins-puzzle-modal-styles';
    style.textContent = `
      .ruins-puzzle-overlay {
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

      .ruins-puzzle-modal {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder(3)};
        border-radius: 12px;
        box-shadow: ${getParchmentShadow()}, 0 0 40px rgba(0, 0, 0, 0.5);
        max-width: 500px;
        width: 90%;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .ruins-puzzle-header {
        padding: 16px 20px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        text-align: center;
      }

      .ruins-puzzle-title {
        margin: 0 0 4px 0;
        color: ${P.accent.gold};
        font-size: 20px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .ruins-puzzle-subtitle {
        color: ${P.text.secondary};
        font-size: 13px;
        font-style: italic;
      }

      .ruins-puzzle-content {
        padding: 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      .ruins-puzzle-stats {
        display: flex;
        gap: 24px;
        justify-content: center;
        padding: 12px;
        background: linear-gradient(to bottom, ${P.mid}, ${P.light});
        border: 1px solid ${P.border};
        border-radius: 8px;
        width: 100%;
      }

      .ruins-puzzle-stat {
        text-align: center;
      }

      .ruins-puzzle-stat-label {
        font-size: 11px;
        color: ${P.text.muted};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .ruins-puzzle-stat-value {
        font-size: 20px;
        font-weight: bold;
        color: ${P.text.primary};
      }

      .ruins-puzzle-stat-value.under-par {
        color: ${P.state.success};
      }

      .ruins-puzzle-grid {
        display: grid;
        gap: 4px;
        background: ${P.borderDark};
        padding: 4px;
        border-radius: 8px;
        box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      .ruins-puzzle-tile {
        width: 70px;
        height: 70px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(to bottom, #e8dcc4, #d4c8a8);
        border: 2px solid ${P.border};
        border-radius: 6px;
        font-size: 24px;
        font-weight: bold;
        color: ${P.text.primary};
        cursor: pointer;
        transition: all 0.15s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .ruins-puzzle-tile:hover:not(.empty):not(.solved) {
        background: linear-gradient(to bottom, #f0e4cc, #e0d4b8);
        transform: scale(1.02);
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.25);
      }

      .ruins-puzzle-tile.empty {
        background: linear-gradient(to bottom, #3a3020, #2a2010);
        border-color: #1a1008;
        cursor: default;
        box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.5);
      }

      .ruins-puzzle-tile.movable {
        border-color: ${P.accent.copper};
        box-shadow: 0 0 8px rgba(198, 145, 68, 0.5);
      }

      .ruins-puzzle-tile.solved {
        cursor: default;
      }

      .ruins-puzzle-reward {
        text-align: center;
        padding: 12px;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 1px solid ${P.border};
        border-radius: 8px;
        width: 100%;
      }

      .ruins-puzzle-reward-label {
        font-size: 12px;
        color: ${P.text.muted};
        margin-bottom: 4px;
      }

      .ruins-puzzle-reward-value {
        font-size: 18px;
        font-weight: bold;
        color: ${P.accent.gold};
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .ruins-puzzle-par {
        font-size: 11px;
        color: ${P.text.secondary};
        margin-top: 4px;
      }

      .ruins-puzzle-actions {
        display: flex;
        gap: 12px;
        padding: 16px 20px;
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        border-top: ${getParchmentBorder()};
      }

      .ruins-puzzle-btn {
        flex: 1;
        padding: 12px 16px;
        font-size: 14px;
        font-weight: bold;
        font-family: Georgia, serif;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .ruins-puzzle-btn-primary {
        background: linear-gradient(to bottom, ${P.state.success}, #3a5538);
        border: 2px solid #2a4028;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .ruins-puzzle-btn-primary:hover:not(:disabled) {
        background: linear-gradient(to bottom, #5a8058, ${P.state.success});
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .ruins-puzzle-btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .ruins-puzzle-btn-secondary {
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 2px solid ${P.border};
        color: ${P.text.primary};
      }

      .ruins-puzzle-btn-secondary:hover {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
      }

      .ruins-puzzle-completed {
        text-align: center;
        padding: 24px;
      }

      .ruins-puzzle-completed-icon {
        font-size: 48px;
        margin-bottom: 12px;
      }

      .ruins-puzzle-completed-title {
        font-size: 22px;
        font-weight: bold;
        color: ${P.accent.gold};
        margin-bottom: 8px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .ruins-puzzle-completed-message {
        color: ${P.text.secondary};
        font-size: 14px;
      }

      /* Grid size adjustments */
      .ruins-puzzle-grid.size-4 .ruins-puzzle-tile {
        width: 60px;
        height: 60px;
        font-size: 20px;
      }

      .ruins-puzzle-grid.size-5 .ruins-puzzle-tile {
        width: 50px;
        height: 50px;
        font-size: 16px;
      }

      @media (max-width: 480px) {
        .ruins-puzzle-tile {
          width: 55px;
          height: 55px;
          font-size: 20px;
        }

        .ruins-puzzle-grid.size-4 .ruins-puzzle-tile {
          width: 48px;
          height: 48px;
          font-size: 16px;
        }

        .ruins-puzzle-grid.size-5 .ruins-puzzle-tile {
          width: 40px;
          height: 40px;
          font-size: 14px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  async show(nodeId) {
    this.teardown();

    this.nodeId = nodeId;
    this.moveCount = 0;
    this.startTime = null;
    this.isCompleted = false;
    this.isSolving = false;

    // Fetch puzzle data from API
    try {
      this.puzzleData = await this.game.api.getRuinsPuzzle(nodeId);

      if (this.puzzleData.isCompleted) {
        this.isCompleted = true;
      } else {
        this.gridSize = this.puzzleData.gridSize;
        this.tiles = [...this.puzzleData.puzzleState];
        this.startTime = Date.now();
      }
    } catch (err) {
      console.error('Failed to load ruins puzzle:', err);
      parchmentToast.error('Error', 'Failed to load puzzle');
      return;
    }

    this.createElement();
    this.setupEventListeners();

    if (!this.isCompleted) {
      this.startTimer();
    }
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'ruins-puzzle-overlay';

    const data = this.puzzleData;

    if (this.isCompleted) {
      // Already completed view
      this.element.innerHTML = `
        <div class="ruins-puzzle-modal">
          <div class="ruins-puzzle-header">
            <h2 class="ruins-puzzle-title">${escapeHtml(data.nodeName)}</h2>
            <div class="ruins-puzzle-subtitle">${escapeHtml(data.theme.name)} - ${escapeHtml(data.theme.description)}</div>
          </div>
          <div class="ruins-puzzle-content">
            <div class="ruins-puzzle-completed">
              <div class="ruins-puzzle-completed-icon">&#9989;</div>
              <div class="ruins-puzzle-completed-title">Already Explored</div>
              <div class="ruins-puzzle-completed-message">
                You solved this puzzle on ${new Date(data.completedAt).toLocaleDateString()}.
                The ancient secrets have been claimed.
              </div>
            </div>
          </div>
          <div class="ruins-puzzle-actions">
            <button class="ruins-puzzle-btn ruins-puzzle-btn-secondary" id="close-btn">Close</button>
          </div>
        </div>
      `;
    } else {
      // Active puzzle view
      this.element.innerHTML = `
        <div class="ruins-puzzle-modal">
          <div class="ruins-puzzle-header">
            <h2 class="ruins-puzzle-title">${escapeHtml(data.nodeName)}</h2>
            <div class="ruins-puzzle-subtitle">${escapeHtml(data.theme.name)} - ${escapeHtml(data.theme.description)}</div>
          </div>
          <div class="ruins-puzzle-content">
            <div class="ruins-puzzle-stats">
              <div class="ruins-puzzle-stat">
                <div class="ruins-puzzle-stat-label">Moves</div>
                <div class="ruins-puzzle-stat-value" id="move-count">${this.moveCount}</div>
              </div>
              <div class="ruins-puzzle-stat">
                <div class="ruins-puzzle-stat-label">Time</div>
                <div class="ruins-puzzle-stat-value" id="timer">0:00</div>
              </div>
              <div class="ruins-puzzle-stat">
                <div class="ruins-puzzle-stat-label">Par</div>
                <div class="ruins-puzzle-stat-value">${data.parMoves}</div>
              </div>
            </div>
            <div class="ruins-puzzle-grid size-${this.gridSize}" id="puzzle-grid" style="grid-template-columns: repeat(${this.gridSize}, 1fr);">
              ${this.renderTiles()}
            </div>
            <div class="ruins-puzzle-reward">
              <div class="ruins-puzzle-reward-label">Reward</div>
              <div class="ruins-puzzle-reward-value">${data.rewards.gold} gold</div>
              <div class="ruins-puzzle-par">${data.rewards.parBonus}</div>
            </div>
          </div>
          <div class="ruins-puzzle-actions">
            <button class="ruins-puzzle-btn ruins-puzzle-btn-secondary" id="reset-btn">Reset</button>
            <button class="ruins-puzzle-btn ruins-puzzle-btn-secondary" id="abandon-btn">Abandon</button>
          </div>
        </div>
      `;
    }

    this.game.uiOverlay.appendChild(this.element);
  }

  renderTiles() {
    return this.tiles.map((value, index) => {
      const isEmpty = value === 0;
      const isMovable = this.canMove(index);
      const classes = ['ruins-puzzle-tile'];
      if (isEmpty) classes.push('empty');
      if (isMovable && !isEmpty) classes.push('movable');

      return `
        <div class="${classes.join(' ')}" data-index="${index}">
          ${isEmpty ? '' : value}
        </div>
      `;
    }).join('');
  }

  canMove(index) {
    const emptyIndex = this.tiles.indexOf(0);
    const emptyRow = Math.floor(emptyIndex / this.gridSize);
    const emptyCol = emptyIndex % this.gridSize;
    const tileRow = Math.floor(index / this.gridSize);
    const tileCol = index % this.gridSize;

    // Check if adjacent (not diagonal)
    const rowDiff = Math.abs(emptyRow - tileRow);
    const colDiff = Math.abs(emptyCol - tileCol);

    return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
  }

  moveTile(index) {
    if (this.isCompleted || this.isSolving) return;
    if (!this.canMove(index)) return;

    const emptyIndex = this.tiles.indexOf(0);

    // Swap tiles
    this.tiles[emptyIndex] = this.tiles[index];
    this.tiles[index] = 0;
    this.moveCount++;

    // Update display
    this.updateGrid();
    this.updateMoveCount();

    // Check for win
    if (this.isPuzzleSolved()) {
      this.handleSolved();
    }
  }

  isPuzzleSolved() {
    for (let i = 0; i < this.tiles.length - 1; i++) {
      if (this.tiles[i] !== i + 1) return false;
    }
    return this.tiles[this.tiles.length - 1] === 0;
  }

  updateGrid() {
    const grid = this.element.querySelector('#puzzle-grid');
    if (grid) {
      grid.innerHTML = this.renderTiles();

      // Re-attach click handlers
      grid.querySelectorAll('.ruins-puzzle-tile').forEach(tile => {
        tile.addEventListener('click', () => {
          const index = parseInt(tile.dataset.index, 10);
          this.moveTile(index);
        });
      });
    }
  }

  updateMoveCount() {
    const moveEl = this.element.querySelector('#move-count');
    if (moveEl) {
      moveEl.textContent = this.moveCount;
      moveEl.classList.toggle('under-par', this.moveCount <= this.puzzleData.parMoves);
    }
  }

  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.updateTimer();
    }, 1000);
  }

  updateTimer() {
    if (!this.element) {
      this.stopTimer();
      return;
    }
    const timerEl = this.element.querySelector('#timer');
    if (timerEl && this.startTime) {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  async handleSolved() {
    this.isSolving = true;
    this.stopTimer();

    try {
      const result = await this.game.api.solveRuinsPuzzle(this.nodeId, this.moveCount);

      // Update player gold
      this.game.state.set('user', {
        ...this.game.state.get('user'),
        gold: result.newGold
      });

      // Show success message
      parchmentToast.success('Puzzle Solved!', result.message);

      // Update UI to show completion
      this.isCompleted = true;
      if (this.onSolve) {
        this.onSolve(result);
      }

      // Close modal after delay
      setTimeout(() => {
        this.close();
      }, 2000);

    } catch (err) {
      console.error('Failed to submit solution:', err);
      parchmentToast.error('Error', err.message || 'Failed to submit solution');
      this.isSolving = false;
    }
  }

  resetPuzzle() {
    if (this.isCompleted || this.isSolving) return;

    // Re-fetch puzzle to get original state
    this.show(this.nodeId);
  }

  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    // Close button (for completed puzzles)
    this.element.querySelector('#close-btn')?.addEventListener('click', () => {
      this.close();
    }, opts);

    // Reset button
    this.element.querySelector('#reset-btn')?.addEventListener('click', () => {
      this.resetPuzzle();
    }, opts);

    // Abandon button
    this.element.querySelector('#abandon-btn')?.addEventListener('click', () => {
      this.close();
    }, opts);

    // Tile clicks
    this.element.querySelectorAll('.ruins-puzzle-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const index = parseInt(tile.dataset.index, 10);
        this.moveTile(index);
      }, opts);
    });

    // Click outside to close
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    }, opts);

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    }, opts);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  teardown() {
    this.stopTimer();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  close() {
    this.teardown();

    if (this.onClose) {
      this.onClose();
    }
  }

  destroy() {
    this.close();
  }
}
