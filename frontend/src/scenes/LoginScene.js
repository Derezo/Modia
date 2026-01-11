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

const STYLE_ID = 'login-scene-styles';

export class LoginScene extends Scene {
  constructor(game) {
    super(game);
    this.formElement = null;
    this.error = null;
    this.loading = false;
    this.fieldsTouched = { username: false, password: false };
  }

  enter() {
    this.error = null;
    this.loading = false;
    this.fieldsTouched = { username: false, password: false };
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
      .login-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 340px;
        max-width: 90%;
        text-align: center;
      }

      .login-title {
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 42px;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        margin-bottom: ${PARCHMENT_SPACING.xl};
        letter-spacing: 2px;
      }

      .login-panel {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        box-shadow: ${getParchmentShadow(true)};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.xl};
      }

      .login-form-group {
        margin-bottom: ${PARCHMENT_SPACING.md};
        text-align: left;
      }

      .login-label {
        display: block;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .login-input {
        width: 100%;
        box-sizing: border-box;
        ${getParchmentInputCSS()}
      }

      .login-input:focus {
        border-color: ${P.borderDark};
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.2);
      }

      .login-input::placeholder {
        color: ${P.text.muted};
      }

      .login-input.input-valid {
        border-color: ${P.state.success};
      }

      .login-input.input-invalid {
        border-color: ${P.state.error};
      }

      .login-input.input-valid:focus {
        box-shadow: 0 0 0 2px rgba(74, 117, 72, 0.2);
      }

      .login-input.input-invalid:focus {
        box-shadow: 0 0 0 2px rgba(139, 68, 68, 0.2);
      }

      .login-field-error {
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        min-height: 16px;
        margin-top: 4px;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .login-field-error.visible {
        opacity: 1;
      }

      .login-error {
        background: rgba(139, 68, 68, 0.15);
        border: 1px solid ${P.state.error};
        border-radius: ${PARCHMENT_RADIUS.sm};
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.md};
        animation: shake 0.4s ease;
      }

      .login-btn {
        width: 100%;
        margin-top: ${PARCHMENT_SPACING.sm};
        ${getParchmentButtonCSS('primary')}
      }

      .login-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .login-btn:active:not(:disabled) {
        transform: translateY(0);
      }

      .login-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .login-btn.btn-loading {
        background: ${P.border};
      }

      .login-switch {
        margin-top: ${PARCHMENT_SPACING.lg};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .login-switch a {
        color: ${P.accent.gold};
        cursor: pointer;
        text-decoration: underline;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .login-switch a:hover {
        color: ${P.border};
      }

      .login-panel.form-loading .login-input {
        opacity: 0.6;
        pointer-events: none;
      }

      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }

      @media (max-width: 600px) {
        .login-container {
          width: 90%;
          max-width: 320px;
        }

        .login-input {
          min-height: 44px;
          padding: 12px 14px;
        }

        .login-btn {
          min-height: 44px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'login-container';
    container.innerHTML = `
      <h1 class="login-title">Modia</h1>
      <div class="login-panel" id="login-panel">
        <div id="auth-error" class="login-error" style="display: none;"></div>
        <form id="login-form">
          <div class="login-form-group">
            <label for="username" class="login-label">Username</label>
            <input type="text" id="username" class="login-input" placeholder="Enter username" autocomplete="username" required>
            <div class="login-field-error" id="username-error"></div>
          </div>
          <div class="login-form-group">
            <label for="password" class="login-label">Password</label>
            <input type="password" id="password" class="login-input" placeholder="Enter password" autocomplete="current-password" required>
            <div class="login-field-error" id="password-error"></div>
          </div>
          <button type="submit" class="login-btn" id="login-btn">Login</button>
        </form>
        <div class="login-switch">
          Don't have an account? <a id="register-link">Register</a>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.formElement = container;

    // Event listeners
    const form = container.querySelector('#login-form');
    const registerLink = container.querySelector('#register-link');
    const usernameInput = container.querySelector('#username');
    const passwordInput = container.querySelector('#password');

    form.addEventListener('submit', (e) => this.handleSubmit(e));
    registerLink.addEventListener('click', () => this.game.scenes.switchTo('register'));

    // Real-time validation
    usernameInput.addEventListener('blur', () => {
      this.fieldsTouched.username = true;
      this.validateField('username');
    });
    usernameInput.addEventListener('input', () => {
      this.clearGlobalError();
      if (this.fieldsTouched.username) this.validateField('username');
    });

    passwordInput.addEventListener('blur', () => {
      this.fieldsTouched.password = true;
      this.validateField('password');
    });
    passwordInput.addEventListener('input', () => {
      this.clearGlobalError();
      if (this.fieldsTouched.password) this.validateField('password');
    });

    // Focus username field
    usernameInput.focus();
  }

  validateField(fieldName) {
    const input = document.getElementById(fieldName);
    const errorEl = document.getElementById(`${fieldName}-error`);
    const value = input.value.trim();
    let error = null;

    if (fieldName === 'username') {
      if (!value) {
        error = 'Username is required';
      }
    } else if (fieldName === 'password') {
      if (!value) {
        error = 'Password is required';
      }
    }

    this.setFieldState(input, errorEl, error);
    return !error;
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
    this.fieldsTouched = { username: true, password: true };
    const usernameValid = this.validateField('username');
    const passwordValid = this.validateField('password');
    return usernameValid && passwordValid;
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
    const password = document.getElementById('password').value;

    this.loading = true;
    this.updateLoadingState();

    try {
      const result = await this.game.api.login(username, password);

      // Store auth data
      this.game.state.set('user', result.user);
      this.game.state.set('token', result.accessToken);
      this.game.state.persist();

      // Store refresh token securely (in memory for MVP)
      this.game.refreshToken = result.refreshToken;

      // Connect WebSocket
      this.game.socket.connect(result.accessToken);

      // Load user settings
      await this.game.loadSettings();

      // Load characters and go to appropriate screen
      const charResult = await this.game.api.getCharacters();
      this.game.state.set('characters', charResult.characters);

      if (charResult.characters.length === 0) {
        this.game.scenes.switchTo('characterCreate');
      } else {
        this.game.scenes.switchTo('worldMap');
      }
    } catch (err) {
      this.showError(this.formatErrorMessage(err.message));
    } finally {
      this.loading = false;
      this.updateLoadingState();
    }
  }

  formatErrorMessage(message) {
    const errorMap = {
      'Unauthorized': 'Invalid username or password',
      'Failed to fetch': 'Unable to connect to server. Please try again.',
      'Unable to connect to server': 'Unable to connect to server. Please try again.'
    };
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
    const btn = document.getElementById('login-btn');
    const panel = document.getElementById('login-panel');

    if (btn) {
      btn.disabled = this.loading;
      if (this.loading) {
        btn.classList.add('btn-loading');
        btn.textContent = 'Logging in...';
      } else {
        btn.classList.remove('btn-loading');
        btn.textContent = 'Login';
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

  update(deltaTime) {
    // No canvas updates needed for login
  }

  render(ctx) {
    // Draw parchment-themed background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw subtle decorative elements with gold accents
    ctx.fillStyle = 'rgba(201, 162, 39, 0.08)';
    for (let i = 0; i < 5; i++) {
      const x = 100 + i * 150;
      const y = 450 + Math.sin(Date.now() / 1000 + i) * 20;
      ctx.beginPath();
      ctx.arc(x, y, 30 + i * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Add subtle corner flourishes
    ctx.strokeStyle = P.border;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;

    // Top-left flourish
    ctx.beginPath();
    ctx.moveTo(20, 60);
    ctx.quadraticCurveTo(20, 20, 60, 20);
    ctx.stroke();

    // Top-right flourish
    ctx.beginPath();
    ctx.moveTo(ctx.canvas.width - 20, 60);
    ctx.quadraticCurveTo(ctx.canvas.width - 20, 20, ctx.canvas.width - 60, 20);
    ctx.stroke();

    // Bottom-left flourish
    ctx.beginPath();
    ctx.moveTo(20, ctx.canvas.height - 60);
    ctx.quadraticCurveTo(20, ctx.canvas.height - 20, 60, ctx.canvas.height - 20);
    ctx.stroke();

    // Bottom-right flourish
    ctx.beginPath();
    ctx.moveTo(ctx.canvas.width - 20, ctx.canvas.height - 60);
    ctx.quadraticCurveTo(ctx.canvas.width - 20, ctx.canvas.height - 20, ctx.canvas.width - 60, ctx.canvas.height - 20);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }
}
