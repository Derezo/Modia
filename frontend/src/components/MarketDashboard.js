/**
 * MarketDashboard - Item market analysis panel with hand-drawn parchment price chart
 *
 * Displays price history, current market conditions, and trading statistics
 * for a selected item in the marketplace. Features a Canvas-based chart
 * with a hand-drawn medieval aesthetic.
 *
 * @example
 * const dashboard = new MarketDashboard(container, {
 *   game: gameInstance,
 *   onBuy: (item, price) => handlePurchase(item, price)
 * });
 * dashboard.setItem(selectedItem);
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentButtonCSS
} from '../ui/parchment/ParchmentTheme.js';

/**
 * Helper function for hand-drawn wobble effect
 * @param {number} value - Base value
 * @param {number} intensity - Wobble intensity (default 2)
 * @returns {number} Value with random offset
 */
function _wobble(value, intensity = 2) {
  return value + (Math.random() - 0.5) * intensity;
}

/**
 * Seeded random for consistent chart rendering
 */
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }

  next() {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  wobble(value, intensity = 2) {
    return value + (this.next() - 0.5) * intensity;
  }
}

export class MarketDashboard {
  /**
   * Create a new MarketDashboard
   * @param {HTMLElement} container - Parent element to render into
   * @param {Object} options - Configuration options
   * @param {Object} options.game - Game instance for API access
   * @param {Function} options.onBuy - Callback when buy button is clicked (item, price)
   */
  constructor(container, options = {}) {
    this.container = container;
    this.game = options.game;
    this.onBuy = options.onBuy;

    this.item = null;
    this.priceHistory = [];
    this.orderBook = null;
    this.stats = null;

    this.element = null;
    this.canvas = null;
    this.ctx = null;

    // Store bound handler for cleanup
    this.boundBuyHandler = null;

    this.injectStyles();
    this.render();
  }

  /**
   * Inject component-specific CSS styles
   */
  injectStyles() {
    if (document.getElementById('market-dashboard-styles')) return;

    const style = document.createElement('style');
    style.id = 'market-dashboard-styles';
    style.textContent = `
      .market-dashboard {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        box-shadow: ${getParchmentShadow()};
        border-radius: 6px;
        padding: ${PARCHMENT_SPACING.md};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${PARCHMENT_COLORS.text.primary};
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.md};
        height: 100%;
        box-sizing: border-box;
      }

      .market-dashboard-header {
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
        padding-bottom: ${PARCHMENT_SPACING.sm};
      }

      .market-dashboard-header h3 {
        margin: 0 0 4px 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .market-dashboard-header .item-meta {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .market-dashboard-chart-section {
        flex: 1;
        min-height: 120px;
      }

      .market-dashboard-chart-section h4 {
        margin: 0 0 ${PARCHMENT_SPACING.xs} 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.secondary};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .market-dashboard-chart-container {
        position: relative;
        width: 100%;
        height: calc(100% - 24px);
        min-height: 100px;
        background: ${PARCHMENT_COLORS.light};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        overflow: hidden;
      }

      .market-dashboard-chart-container canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .market-dashboard-chart-stats {
        display: flex;
        justify-content: space-between;
        margin-top: ${PARCHMENT_SPACING.xs};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .market-dashboard-section {
        border-top: 1px solid ${PARCHMENT_COLORS.border};
        padding-top: ${PARCHMENT_SPACING.sm};
      }

      .market-dashboard-section h4 {
        margin: 0 0 ${PARCHMENT_SPACING.xs} 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.secondary};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .market-dashboard-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: ${PARCHMENT_SPACING.sm};
        text-align: center;
      }

      .market-dashboard-stat {
        padding: ${PARCHMENT_SPACING.xs};
        background: rgba(0, 0, 0, 0.05);
        border-radius: 4px;
      }

      .market-dashboard-stat .label {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        color: ${PARCHMENT_COLORS.text.muted};
        margin-bottom: 2px;
      }

      .market-dashboard-stat .value {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: bold;
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .market-dashboard-stat .value.positive {
        color: ${PARCHMENT_COLORS.state.success};
      }

      .market-dashboard-stat .value.negative {
        color: ${PARCHMENT_COLORS.state.error};
      }

      .market-dashboard-actions {
        margin-top: auto;
        padding-top: ${PARCHMENT_SPACING.sm};
        border-top: 1px solid ${PARCHMENT_COLORS.border};
      }

      .market-dashboard-buy-btn {
        ${getParchmentButtonCSS('primary')}
        width: 100%;
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
      }

      .market-dashboard-buy-btn:hover {
        filter: brightness(1.1);
      }

      .market-dashboard-buy-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .market-dashboard-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Render the dashboard structure
   */
  render() {
    this.element = document.createElement('div');
    this.element.className = 'market-dashboard';

    if (!this.item) {
      this.element.innerHTML = `
        <div class="market-dashboard-empty">
          Select an item to view market data
        </div>
      `;
    } else {
      this.renderContent();
    }

    this.container.innerHTML = '';
    this.container.appendChild(this.element);
  }

  /**
   * Render dashboard content when an item is selected
   */
  renderContent() {
    const { item, priceHistory: _priceHistory, orderBook, stats } = this;
    const bestAsk = orderBook?.bestAsk || stats?.avgPrice || item.price || 0;
    const bestBid = orderBook?.bestBid || Math.round(bestAsk * 0.9);
    const spread = bestAsk > 0 ? (((bestAsk - bestBid) / bestAsk) * 100).toFixed(1) : 0;

    // Calculate chart stats
    const chartStats = this.calculateChartStats();

    this.element.innerHTML = `
      <div class="market-dashboard-header">
        <h3>${item.name || item.generatedName || 'Unknown Item'}</h3>
        <div class="item-meta">
          ${this.formatRarity(item.rarity)} • ${item.itemType || item.type || 'Item'}
          ${item.material ? ` • ${item.material}` : ''}
        </div>
      </div>

      <div class="market-dashboard-chart-section">
        <h4>Price History (7 days)</h4>
        <div class="market-dashboard-chart-container">
          <canvas id="price-chart-canvas"></canvas>
        </div>
        <div class="market-dashboard-chart-stats">
          <span>Low: ${chartStats.low}g</span>
          <span>High: ${chartStats.high}g</span>
        </div>
      </div>

      <div class="market-dashboard-section">
        <h4>Current Market</h4>
        <div class="market-dashboard-grid">
          <div class="market-dashboard-stat">
            <div class="label">Bid</div>
            <div class="value">${bestBid}g</div>
          </div>
          <div class="market-dashboard-stat">
            <div class="label">Ask</div>
            <div class="value">${bestAsk}g</div>
          </div>
          <div class="market-dashboard-stat">
            <div class="label">Spread</div>
            <div class="value">${spread}%</div>
          </div>
        </div>
      </div>

      <div class="market-dashboard-section">
        <h4>Activity (24h)</h4>
        <div class="market-dashboard-grid">
          <div class="market-dashboard-stat">
            <div class="label">Volume</div>
            <div class="value">${stats?.volume24h || 0}</div>
          </div>
          <div class="market-dashboard-stat">
            <div class="label">Trades</div>
            <div class="value">${stats?.trades24h || 0}</div>
          </div>
          <div class="market-dashboard-stat">
            <div class="label">Trend</div>
            <div class="value ${stats?.trend > 0 ? 'positive' : stats?.trend < 0 ? 'negative' : ''}">
              ${stats?.trend > 0 ? '↑' : stats?.trend < 0 ? '↓' : '−'}${Math.abs(stats?.trend || 0).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      <div class="market-dashboard-actions">
        <button class="market-dashboard-buy-btn" ${bestAsk <= 0 ? 'disabled' : ''}>
          Buy Now: ${bestAsk}g
        </button>
      </div>
    `;

    // Setup canvas and render chart
    this.canvas = this.element.querySelector('#price-chart-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.resizeCanvas();
      this.renderPriceChart();
    }

    // Setup buy button with stored handler for cleanup
    const buyBtn = this.element.querySelector('.market-dashboard-buy-btn');
    if (buyBtn) {
      // Remove previous handler if exists
      if (this.boundBuyHandler && this.buyBtn) {
        this.buyBtn.removeEventListener('click', this.boundBuyHandler);
      }

      this.buyBtn = buyBtn;
      this.boundBuyHandler = () => {
        if (this.onBuy && bestAsk > 0) {
          this.onBuy(this.item, bestAsk);
        }
      };
      buyBtn.addEventListener('click', this.boundBuyHandler);
    }
  }

  /**
   * Calculate statistics for the price chart
   * @returns {Object} Chart statistics
   */
  calculateChartStats() {
    if (!this.priceHistory || this.priceHistory.length === 0) {
      return { low: 0, high: 0, avg: 0 };
    }

    const prices = this.priceHistory.map(t => t.price);
    return {
      low: Math.min(...prices),
      high: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    };
  }

  /**
   * Resize canvas to match container
   */
  resizeCanvas() {
    if (!this.canvas) return;

    const container = this.canvas.parentElement;
    const rect = container.getBoundingClientRect();

    // Set actual canvas size (for crisp rendering)
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    // Reset transform before applying scale (prevents compounding)
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Scale context for device pixel ratio
    this.ctx.scale(dpr, dpr);

    // Store logical dimensions
    this.chartWidth = rect.width;
    this.chartHeight = rect.height;
  }

  /**
   * Render the hand-drawn parchment price chart
   */
  renderPriceChart() {
    const { ctx, chartWidth, chartHeight, priceHistory } = this;
    if (!ctx || !chartWidth || !chartHeight) return;

    // Use seeded random for consistent wobble
    const rng = new SeededRandom(this.item?.id || 12345);

    // Chart padding
    const padding = { top: 10, right: 10, bottom: 20, left: 40 };
    const plotWidth = chartWidth - padding.left - padding.right;
    const plotHeight = chartHeight - padding.top - padding.bottom;

    // 1. Draw parchment background with subtle noise texture
    this.drawParchmentBackground(ctx, chartWidth, chartHeight, rng);

    // 2. Draw grid lines with hand-drawn wobble
    this.drawGridLines(ctx, padding, plotWidth, plotHeight, rng);

    // 3. Draw price axis labels
    this.drawAxisLabels(ctx, padding, plotWidth, plotHeight);

    // 4. Draw price line if we have data
    if (priceHistory && priceHistory.length > 1) {
      this.drawPriceLine(ctx, padding, plotWidth, plotHeight, rng);
    } else {
      // No data message
      ctx.fillStyle = PARCHMENT_COLORS.text.muted;
      ctx.font = `italic 12px ${PARCHMENT_TYPOGRAPHY.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillText('No trade history available', chartWidth / 2, chartHeight / 2);
    }
  }

  /**
   * Draw parchment background with subtle texture
   */
  drawParchmentBackground(ctx, width, height, rng) {
    // Base parchment color
    ctx.fillStyle = PARCHMENT_COLORS.light;
    ctx.fillRect(0, 0, width, height);

    // Add subtle noise texture
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const noise = (rng.next() - 0.5) * 8;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));     // R
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise)); // G
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise)); // B
    }

    ctx.putImageData(imageData, 0, 0);

    // Add slight vignette effect
    const gradient = ctx.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, Math.max(width, height) * 0.7
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Draw grid lines with hand-drawn wobble effect
   */
  drawGridLines(ctx, padding, plotWidth, plotHeight, rng) {
    ctx.save();
    ctx.strokeStyle = PARCHMENT_COLORS.border;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;

    // Horizontal grid lines (5 lines)
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotHeight * i / 4);
      ctx.beginPath();

      // Hand-drawn wobble
      for (let x = padding.left; x <= padding.left + plotWidth; x += 8) {
        const wobbleY = rng.wobble(y, 1);
        if (x === padding.left) {
          ctx.moveTo(x, wobbleY);
        } else {
          ctx.lineTo(x, wobbleY);
        }
      }
      ctx.stroke();
    }

    // Vertical grid lines (7 lines for 7 days)
    for (let i = 0; i <= 6; i++) {
      const x = padding.left + (plotWidth * i / 6);
      ctx.beginPath();

      // Hand-drawn wobble
      for (let y = padding.top; y <= padding.top + plotHeight; y += 8) {
        const wobbleX = rng.wobble(x, 1);
        if (y === padding.top) {
          ctx.moveTo(wobbleX, y);
        } else {
          ctx.lineTo(wobbleX, y);
        }
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draw axis labels
   */
  drawAxisLabels(ctx, padding, plotWidth, plotHeight) {
    if (!this.priceHistory || this.priceHistory.length === 0) return;

    const prices = this.priceHistory.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;

    ctx.fillStyle = PARCHMENT_COLORS.text.muted;
    ctx.font = `10px ${PARCHMENT_TYPOGRAPHY.fontFamily}`;
    ctx.textAlign = 'right';

    // Price labels on Y axis
    for (let i = 0; i <= 4; i++) {
      const price = maxPrice - (priceRange * i / 4);
      const y = padding.top + (plotHeight * i / 4);
      ctx.fillText(`${Math.round(price)}g`, padding.left - 4, y + 3);
    }

    // Day labels on X axis
    ctx.textAlign = 'center';
    const days = ['7d', '6d', '5d', '4d', '3d', '2d', '1d'];
    for (let i = 0; i < days.length; i++) {
      const x = padding.left + (plotWidth * i / 6);
      ctx.fillText(days[i], x, padding.top + plotHeight + 14);
    }
  }

  /**
   * Draw the price line with hand-drawn effect
   */
  drawPriceLine(ctx, padding, plotWidth, plotHeight, rng) {
    const { priceHistory } = this;
    if (!priceHistory || priceHistory.length < 2) return;

    // Group trades by day and calculate daily average
    const dailyPrices = this.aggregateDailyPrices();
    if (dailyPrices.length < 2) return;

    const prices = dailyPrices.map(d => d.avgPrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;

    // Calculate points
    const points = dailyPrices.map((day, i) => ({
      x: padding.left + (plotWidth * i / (dailyPrices.length - 1)),
      y: padding.top + plotHeight - ((day.avgPrice - minPrice) / priceRange * plotHeight)
    }));

    // Draw area fill
    ctx.beginPath();
    ctx.moveTo(points[0].x, padding.top + plotHeight);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      ctx.lineTo(rng.wobble(p.x, 1), rng.wobble(p.y, 1));
    }

    ctx.lineTo(points[points.length - 1].x, padding.top + plotHeight);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
    gradient.addColorStop(0, 'rgba(139, 115, 85, 0.3)');
    gradient.addColorStop(1, 'rgba(139, 115, 85, 0.05)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw the line with hand-drawn effect using bezier curves
    ctx.strokeStyle = PARCHMENT_COLORS.borderDark;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(rng.wobble(points[0].x, 1), rng.wobble(points[0].y, 1));

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      // Use quadratic bezier for smoother hand-drawn effect
      const cpX = (prev.x + curr.x) / 2;
      const cpY = (prev.y + curr.y) / 2;

      ctx.quadraticCurveTo(
        rng.wobble(cpX, 2),
        rng.wobble(cpY, 2),
        rng.wobble(curr.x, 1),
        rng.wobble(curr.y, 1)
      );
    }

    // Add slight line width variation
    ctx.lineWidth = 1.5 + rng.next() * 1;
    ctx.stroke();

    // Mark min and max points with hand-drawn dots
    const minIdx = prices.indexOf(minPrice);
    const maxIdx = prices.indexOf(maxPrice);

    this.drawHandDrawnDot(ctx, points[minIdx], PARCHMENT_COLORS.state.error, rng);
    this.drawHandDrawnDot(ctx, points[maxIdx], PARCHMENT_COLORS.state.success, rng);
  }

  /**
   * Draw a hand-drawn ink dot
   */
  drawHandDrawnDot(ctx, point, color, rng) {
    ctx.fillStyle = color;
    ctx.beginPath();

    // Slightly irregular circle
    const radius = 4;
    const segments = 8;

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = radius + rng.wobble(0, 1);
      const x = point.x + Math.cos(angle) * r;
      const y = point.y + Math.sin(angle) * r;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.fill();
  }

  /**
   * Aggregate trade history into daily price averages
   * @returns {Array} Array of daily price data
   */
  aggregateDailyPrices() {
    if (!this.priceHistory || this.priceHistory.length === 0) return [];

    const now = new Date();
    const days = [];

    // Initialize 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      days.push({
        date,
        prices: [],
        avgPrice: 0,
        volume: 0
      });
    }

    // Group trades by day
    for (const trade of this.priceHistory) {
      const tradeDate = new Date(trade.executedAt || trade.executed_at);
      tradeDate.setHours(0, 0, 0, 0);

      for (const day of days) {
        if (day.date.getTime() === tradeDate.getTime()) {
          day.prices.push(trade.price);
          day.volume += trade.quantity || 1;
          break;
        }
      }
    }

    // Calculate averages, interpolate missing days
    let lastPrice = this.priceHistory[0]?.price || 0;

    for (const day of days) {
      if (day.prices.length > 0) {
        day.avgPrice = Math.round(day.prices.reduce((a, b) => a + b, 0) / day.prices.length);
        lastPrice = day.avgPrice;
      } else {
        day.avgPrice = lastPrice; // Carry forward last known price
      }
    }

    return days;
  }

  /**
   * Format rarity value to display string
   */
  formatRarity(rarity) {
    const rarities = ['', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    return rarities[rarity] || 'Common';
  }

  /**
   * Set the item to display market data for
   * @param {Object} item - Item object with id/templateId
   */
  async setItem(item) {
    this.item = item;
    this.priceHistory = [];
    this.orderBook = null;
    this.stats = null;

    if (item && this.game?.api) {
      try {
        // Fetch trade history
        const templateId = item.templateId || item.itemTemplateId || item.id;
        const historyResult = await this.game.api.getTradeHistory(templateId, 200);
        this.priceHistory = historyResult.trades || [];

        // Calculate 24h stats
        this.stats = this.calculate24hStats();

        // Try to get order book data
        try {
          const orderBookResult = await this.game.api.getOrderBook(templateId);
          this.orderBook = orderBookResult;
        } catch {
          // Order book might not exist for all items
        }
      } catch (err) {
        console.error('Failed to load market data:', err);
      }
    }

    this.render();
  }

  /**
   * Calculate 24-hour trading statistics
   * @returns {Object} Statistics object
   */
  calculate24hStats() {
    if (!this.priceHistory || this.priceHistory.length === 0) {
      return { volume24h: 0, trades24h: 0, trend: 0, avgPrice: 0 };
    }

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    let volume24h = 0;
    let trades24h = 0;
    let sum24h = 0;
    let sumPrev24h = 0;
    let countPrev24h = 0;

    for (const trade of this.priceHistory) {
      const tradeDate = new Date(trade.executedAt || trade.executed_at);

      if (tradeDate >= oneDayAgo) {
        volume24h += trade.quantity || 1;
        trades24h++;
        sum24h += trade.price;
      } else if (tradeDate >= twoDaysAgo) {
        sumPrev24h += trade.price;
        countPrev24h++;
      }
    }

    const avg24h = trades24h > 0 ? sum24h / trades24h : 0;
    const avgPrev24h = countPrev24h > 0 ? sumPrev24h / countPrev24h : avg24h;
    const trend = avgPrev24h > 0 ? ((avg24h - avgPrev24h) / avgPrev24h) * 100 : 0;

    return {
      volume24h,
      trades24h,
      trend,
      avgPrice: Math.round(avg24h)
    };
  }

  /**
   * Clear the dashboard
   */
  clear() {
    this.item = null;
    this.priceHistory = [];
    this.orderBook = null;
    this.stats = null;
    this.render();
  }

  /**
   * Destroy the dashboard and clean up
   */
  destroy() {
    // Remove event listener
    if (this.boundBuyHandler && this.buyBtn) {
      this.buyBtn.removeEventListener('click', this.boundBuyHandler);
      this.boundBuyHandler = null;
      this.buyBtn = null;
    }

    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    this.canvas = null;
    this.ctx = null;
  }
}

export default MarketDashboard;
