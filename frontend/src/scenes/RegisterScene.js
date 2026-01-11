import { Scene } from './Scene.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentInputCSS,
  getParchmentButtonCSS
} from '../ui/parchment/index.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

const STYLE_ID = 'register-scene-styles';

export class RegisterScene extends Scene {
  constructor(game) {
    super(game);
    this.formElement = null;
    this.loading = false;
    this.fieldsTouched = {
      username: false,
      email: false,
      password: false,
      'confirm-password': false
    };
  }

  enter() {
    this.loading = false;
    this.fieldsTouched = {
      username: false,
      email: false,
      password: false,
      'confirm-password': false
    };
    this.addStyles();
    this.createUI();
  }

  exit() {
    if (this.formElement) {
      this.formElement.remove();
      this.formElement = null;
    }
    // Clean up styles
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .register-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 340px;
        max-width: 90%;
        text-align: center;
      }

      .register-title {
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 42px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        margin-bottom: ${PARCHMENT_SPACING.xl};
        letter-spacing: 2px;
      }

      .register-panel {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        box-shadow: ${getParchmentShadow(true)};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.xl};
      }

      .register-panel-header {
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin-bottom: ${PARCHMENT_SPACING.lg};
        padding-bottom: ${PARCHMENT_SPACING.sm};
        border-bottom: 1px solid ${P.border};
      }

      .register-form-group {
        margin-bottom: ${PARCHMENT_SPACING.md};
        text-align: left;
      }

      .register-label {
        display: block;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .register-input {
        width: 100%;
        box-sizing: border-box;
        ${getParchmentInputCSS()}
      }

      .register-input:focus {
        border-color: ${P.borderDark};
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.2);
      }

      .register-input::placeholder {
        color: ${P.text.muted};
      }

      .register-input.input-valid {
        border-color: ${P.state.success};
      }

      .register-input.input-invalid {
        border-color: ${P.state.error};
      }

      .register-input.input-valid:focus {
        box-shadow: 0 0 0 2px rgba(74, 117, 72, 0.2);
      }

      .register-input.input-invalid:focus {
        box-shadow: 0 0 0 2px rgba(139, 68, 68, 0.2);
      }

      .register-field-error {
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        min-height: 16px;
        margin-top: 4px;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .register-field-error.visible {
        opacity: 1;
      }

      .register-error {
        background: rgba(139, 68, 68, 0.15);
        border: 1px solid ${P.state.error};
        border-radius: ${PARCHMENT_RADIUS.sm};
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.md};
        animation: registerShake 0.4s ease;
      }

      .register-btn {
        width: 100%;
        margin-top: ${PARCHMENT_SPACING.sm};
        ${getParchmentButtonCSS('primary')}
      }

      .register-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .register-btn:active:not(:disabled) {
        transform: translateY(0);
      }

      .register-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .register-btn.btn-loading {
        background: ${P.border};
      }

      .register-switch {
        margin-top: ${PARCHMENT_SPACING.lg};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .register-switch a {
        color: ${P.accent.gold};
        cursor: pointer;
        text-decoration: underline;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .register-switch a:hover {
        color: ${P.border};
      }

      .register-panel.form-loading .register-input {
        opacity: 0.6;
        pointer-events: none;
      }

      @keyframes registerShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }

      @media (max-width: 600px) {
        .register-container {
          width: 90%;
          max-width: 320px;
        }

        .register-input {
          min-height: 44px;
          padding: 12px 14px;
        }

        .register-btn {
          min-height: 44px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'register-container';
    container.innerHTML = `
      <h1 class="register-title">Modia</h1>
      <div class="register-panel" id="register-panel">
        <div class="register-panel-header">Create Account</div>
        <div id="auth-error" class="register-error" style="display: none;"></div>
        <form id="register-form">
          <div class="register-form-group">
            <label for="username" class="register-label">Username</label>
            <input type="text" id="username" class="register-input" placeholder="3-32 characters" autocomplete="username" required minlength="3" maxlength="32">
            <div class="register-field-error" id="username-error"></div>
          </div>
          <div class="register-form-group">
            <label for="email" class="register-label">Email</label>
            <input type="email" id="email" class="register-input" placeholder="your@email.com" autocomplete="email" required>
            <div class="register-field-error" id="email-error"></div>
          </div>
          <div class="register-form-group">
            <label for="password" class="register-label">Password</label>
            <input type="password" id="password" class="register-input" placeholder="8+ characters" autocomplete="new-password" required minlength="8">
            <div class="register-field-error" id="password-error"></div>
          </div>
          <div class="register-form-group">
            <label for="confirm-password" class="register-label">Confirm Password</label>
            <input type="password" id="confirm-password" class="register-input" placeholder="Repeat password" autocomplete="new-password" required>
            <div class="register-field-error" id="confirm-password-error"></div>
          </div>
          <button type="submit" class="register-btn" id="register-btn">Register</button>
        </form>
        <div class="register-switch">
          Already have an account? <a id="login-link">Login</a>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.formElement = container;

    // Event listeners
    const form = container.querySelector('#register-form');
    const loginLink = container.querySelector('#login-link');

    form.addEventListener('submit', (e) => this.handleSubmit(e));
    loginLink.addEventListener('click', () => this.game.scenes.switchTo('login'));

    // Real-time validation for all fields
    const fields = ['username', 'email', 'password', 'confirm-password'];
    fields.forEach(fieldName => {
      const input = container.querySelector(`#${fieldName}`);
      input.addEventListener('blur', () => {
        this.fieldsTouched[fieldName] = true;
        this.validateField(fieldName);
      });
      input.addEventListener('input', () => {
        this.clearGlobalError();
        if (this.fieldsTouched[fieldName]) {
          this.validateField(fieldName);
        }
        // Re-validate confirm password when password changes
        if (fieldName === 'password' && this.fieldsTouched['confirm-password']) {
          this.validateField('confirm-password');
        }
      });
    });

    container.querySelector('#username').focus();
  }

  validateField(fieldName) {
    const input = document.getElementById(fieldName);
    const errorEl = document.getElementById(`${fieldName}-error`);
    const value = input.value.trim();
    let error = null;

    switch (fieldName) {
      case 'username':
        if (!value) {
          error = 'Username is required';
        } else if (value.length < 3) {
          error = 'Username must be at least 3 characters';
        } else if (value.length > 32) {
          error = 'Username must be 32 characters or less';
        } else if (!/^[a-zA-Z0-9_]+$/.test(value)) {
          error = 'Username can only contain letters, numbers, and underscores';
        }
        break;

      case 'email':
        if (!value) {
          error = 'Email is required';
        } else if (!this.isValidEmail(value)) {
          error = 'Please enter a valid email address';
        }
        break;

      case 'password':
        if (!value) {
          error = 'Password is required';
        } else if (value.length < 8) {
          error = 'Password must be at least 8 characters';
        }
        break;

      case 'confirm-password':
        const password = document.getElementById('password').value;
        if (!value) {
          error = 'Please confirm your password';
        } else if (value !== password) {
          error = 'Passwords do not match';
        }
        break;
    }

    this.setFieldState(input, errorEl, error);
    return !error;
  }

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  setFieldState(input, errorEl, error) {
    input.classList.remove('input-valid', 'input-invalid');
    errorEl.classList.remove('visible');

    if (error) {
      input.classList.add('input-invalid');
      errorEl.textContent = error;
      errorEl.classList.add('visible');
    } else if (input.value.trim()) {
      input.classList.add('input-valid');
    }
  }

  validateAllFields() {
    const fields = ['username', 'email', 'password', 'confirm-password'];
    fields.forEach(field => this.fieldsTouched[field] = true);

    return fields.every(field => this.validateField(field));
  }

  clearGlobalError() {
    const errorEl = document.getElementById('auth-error');
    if (errorEl) {
      errorEl.style.display = 'none';
    }
  }

  async handleSubmit(e) {
    e.preventDefault();

    if (this.loading) return;

    if (!this.validateAllFields()) {
      return;
    }

    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    this.loading = true;
    this.updateLoadingState();

    try {
      const result = await this.game.api.register(username, email, password);

      // Store auth data
      this.game.state.set('user', result.user);
      this.game.state.set('token', result.accessToken);
      this.game.state.persist();

      this.game.refreshToken = result.refreshToken;

      // Connect WebSocket
      this.game.socket.connect(result.accessToken);

      // Load user settings (will create defaults for new user)
      await this.game.loadSettings();

      // New user, go to character creation
      this.game.scenes.switchTo('characterCreate');
    } catch (err) {
      this.showError(this.formatErrorMessage(err.message));
    } finally {
      this.loading = false;
      this.updateLoadingState();
    }
  }

  formatErrorMessage(message) {
    const errorMap = {
      'Failed to fetch': 'Unable to connect to server. Please try again.',
      'Unable to connect to server': 'Unable to connect to server. Please try again.'
    };
    // Handle specific server errors
    if (message.toLowerCase().includes('username') && message.toLowerCase().includes('taken')) {
      return 'This username is already taken. Please choose another.';
    }
    if (message.toLowerCase().includes('email') && message.toLowerCase().includes('taken')) {
      return 'An account with this email already exists.';
    }
    return errorMap[message] || message;
  }

  showError(message) {
    const errorEl = document.getElementById('auth-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      // Re-trigger animation
      errorEl.style.animation = 'none';
      errorEl.offsetHeight; // Trigger reflow
      errorEl.style.animation = null;
    }
  }

  updateLoadingState() {
    const btn = document.getElementById('register-btn');
    const panel = document.getElementById('register-panel');

    if (btn) {
      btn.disabled = this.loading;
      if (this.loading) {
        btn.classList.add('btn-loading');
        btn.textContent = 'Creating account...';
      } else {
        btn.classList.remove('btn-loading');
        btn.textContent = 'Register';
      }
    }

    if (panel) {
      if (this.loading) {
        panel.classList.add('form-loading');
      } else {
        panel.classList.remove('form-loading');
      }
    }
  }

  update(deltaTime) {}

  render(ctx) {
    // Draw stone wall background
    this.renderStoneWall(ctx);
  }

  /**
   * Render a pixel-art style stone wall background.
   */
  renderStoneWall(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // Stone colors
    const stoneColors = ['#7a7a6a', '#8a8a7a', '#6a6a5a', '#9a9a8a', '#5a5a4a'];
    const mortarColor = '#4a4a3a';

    // Fill with mortar color first
    ctx.fillStyle = mortarColor;
    ctx.fillRect(0, 0, w, h);

    // Stone block dimensions
    const blockWidth = 64;
    const blockHeight = 32;
    const mortarGap = 3;

    // Draw stone blocks in a brick pattern
    const rows = Math.ceil(h / blockHeight) + 1;
    const cols = Math.ceil(w / blockWidth) + 1;

    for (let row = 0; row < rows; row++) {
      // Offset every other row for brick pattern
      const offsetX = (row % 2) * (blockWidth / 2);

      for (let col = -1; col < cols; col++) {
        const x = col * blockWidth + offsetX;
        const y = row * blockHeight;

        // Use seeded random for consistent stone colors
        const seed = (row * 31 + col * 17) % stoneColors.length;
        const baseColor = stoneColors[seed];

        // Draw the stone block
        this.drawStoneBlock(ctx, x + mortarGap / 2, y + mortarGap / 2,
          blockWidth - mortarGap, blockHeight - mortarGap, baseColor, row, col);
      }
    }

    // Add subtle vignette for depth
    const vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Draw a single stone block with texture.
   */
  drawStoneBlock(ctx, x, y, width, height, baseColor, row, col) {
    // Parse base color to create variations
    const r = parseInt(baseColor.slice(1, 3), 16);
    const g = parseInt(baseColor.slice(3, 5), 16);
    const b = parseInt(baseColor.slice(5, 7), 16);

    // Main stone fill with subtle gradient
    const gradient = ctx.createLinearGradient(x, y, x, y + height);
    gradient.addColorStop(0, `rgb(${r + 15}, ${g + 15}, ${b + 10})`);
    gradient.addColorStop(0.5, baseColor);
    gradient.addColorStop(1, `rgb(${r - 20}, ${g - 20}, ${b - 15})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);

    // Add stone texture (small pixel variations)
    const seed = row * 100 + col;
    for (let i = 0; i < 8; i++) {
      const px = x + ((seed + i * 7) % (width - 4)) + 2;
      const py = y + ((seed + i * 11) % (height - 4)) + 2;
      const shade = ((seed + i) % 3) - 1;
      ctx.fillStyle = `rgba(${shade > 0 ? 255 : 0}, ${shade > 0 ? 255 : 0}, ${shade > 0 ? 255 : 0}, 0.1)`;
      ctx.fillRect(px, py, 2, 2);
    }

    // Top highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(x, y, width, 2);

    // Bottom shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(x, y + height - 2, width, 2);

    // Left highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x, y, 2, height);

    // Right shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(x + width - 2, y, 2, height);
  }
}
