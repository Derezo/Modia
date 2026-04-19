import { Scene } from './Scene.js';
import { AuthTransitionRenderer } from './auth/AuthTransitionRenderer.js';
import { RegistrationWizard } from './auth/RegistrationWizard.js';
import { ChangelogModal } from '../components/modals/ChangelogModal.js';
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

const P = PARCHMENT_COLORS;
const STYLE_ID = 'auth-scene-styles';

/**
 * Unified authentication scene handling both login and registration.
 * Features cinematic transition from title animation with floating particles,
 * gradient background, and delayed modal appearance.
 */
export class AuthScene extends Scene {
  constructor(game) {
    super(game);
    this.formElement = null;
    this.mode = 'login'; // 'login' or 'register'
    this.loading = false;
    this.fieldsTouched = {};
    this.transitioning = false;

    // Transition state
    this.transitionRenderer = null;
    this.fontLoaded = false;
    this.modalVisible = false;

    // Registration wizard
    this.wizard = null;

    // Changelog modal
    this.changelogModal = null;
  }

  enter(params = {}) {
    this.mode = params.mode || 'login';
    this.loading = false;
    this.modalVisible = false;
    this.resetFieldsTouched();

    // Create transition renderer
    this.transitionRenderer = new AuthTransitionRenderer(
      this.game.targetWidth,
      this.game.targetHeight
    );

    // Start font preload immediately
    this.preloadFont();

    // Add styles (but don't create modal yet)
    this.addStyles();

    // Continue title theme music (don't restart if already playing)
    if (this.game.musicContext) {
      this.game.musicContext.playTitleTheme();
    }
  }

  exit() {
    if (this.formElement) {
      this.formElement.remove();
      this.formElement = null;
    }
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();

    // Clean up registration wizard
    if (this.wizard) {
      this.wizard.destroy();
      this.wizard = null;
    }

    this.transitionRenderer = null;
    this.modalVisible = false;
  }

  /**
   * Preload the Cinzel Decorative font to prevent FOUC.
   */
  async preloadFont() {
    try {
      // Inject the Google Fonts stylesheet if not already present
      if (!document.getElementById('cinzel-decorative-font')) {
        const link = document.createElement('link');
        link.id = 'cinzel-decorative-font';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&display=swap';
        document.head.appendChild(link);
      }

      // Wait for the font to be ready
      await document.fonts.ready;

      // Check if the font actually loaded
      const fontLoaded = document.fonts.check('700 16px "Cinzel Decorative"');
      if (!fontLoaded) {
        // Give it a bit more time
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.fontLoaded = true;

      // Signal to transition renderer
      if (this.transitionRenderer) {
        this.transitionRenderer.setFontReady();
      }
    } catch (e) {
      // Continue with fallback font if loading fails
      console.warn('Font preload failed, using fallback:', e);
      this.fontLoaded = true;
      if (this.transitionRenderer) {
        this.transitionRenderer.setFontReady();
      }
    }
  }

  resetFieldsTouched() {
    this.fieldsTouched = {
      username: false,
      email: false,
      password: false,
      'confirm-password': false
    };
  }

  addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Font is preloaded via FontFace API */

      .auth-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 360px;
        max-width: 90%;
        text-align: center;
        /* Initially hidden for fade-in */
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.95);
        transition: opacity 0.5s ease, transform 0.5s ease;
      }

      .auth-container.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }

      .auth-panel {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        box-shadow: ${getParchmentShadow(true)}, 0 20px 60px rgba(0, 0, 0, 0.5);
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.xl};
        position: relative;
        overflow: hidden;
      }

      .auth-panel-header {
        color: ${P.text.primary};
        font-family: 'Cinzel Decorative', ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 20px;
        font-weight: 700;
        margin-bottom: ${PARCHMENT_SPACING.lg};
        padding-bottom: ${PARCHMENT_SPACING.sm};
        border-bottom: 2px solid ${P.border};
        letter-spacing: 2px;
      }

      .auth-form-group {
        margin-bottom: ${PARCHMENT_SPACING.md};
        text-align: left;
        overflow: hidden;
        transition: max-height 0.35s ease, opacity 0.25s ease, margin 0.35s ease;
      }

      .auth-form-group.hidden {
        max-height: 0;
        opacity: 0;
        margin-bottom: 0;
        pointer-events: none;
      }

      .auth-form-group.visible {
        max-height: 100px;
        opacity: 1;
      }

      .auth-label {
        display: block;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .auth-input {
        width: 100%;
        box-sizing: border-box;
        ${getParchmentInputCSS()}
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }

      .auth-input:focus {
        border-color: ${P.borderDark};
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.3);
        outline: none;
      }

      .auth-input::placeholder {
        color: ${P.text.muted};
      }

      .auth-input.input-valid {
        border-color: ${P.state.success};
      }

      .auth-input.input-invalid {
        border-color: ${P.state.error};
      }

      .auth-field-error {
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        min-height: 16px;
        margin-top: 4px;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .auth-field-error.visible {
        opacity: 1;
      }

      .auth-error {
        background: rgba(139, 68, 68, 0.15);
        border: 1px solid ${P.state.error};
        border-radius: ${PARCHMENT_RADIUS.sm};
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        margin-bottom: ${PARCHMENT_SPACING.md};
        animation: authShake 0.4s ease;
      }

      .auth-btn {
        width: 100%;
        margin-top: ${PARCHMENT_SPACING.md};
        ${getParchmentButtonCSS('primary')}
        font-family: 'Cinzel Decorative', ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 14px;
        letter-spacing: 1px;
        transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease;
      }

      .auth-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .auth-btn:active:not(:disabled) {
        transform: translateY(0);
      }

      .auth-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .auth-btn.btn-loading {
        background: ${P.border};
      }

      .auth-switch {
        margin-top: ${PARCHMENT_SPACING.lg};
        color: ${P.text.secondary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .auth-switch a {
        color: ${P.borderDark};
        cursor: pointer;
        text-decoration: underline;
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        transition: color 0.15s ease;
      }

      .auth-switch a:hover {
        color: ${P.text.primary};
      }

      .auth-panel.form-loading .auth-input {
        opacity: 0.6;
        pointer-events: none;
      }

      .auth-divider {
        display: flex;
        align-items: center;
        margin: ${PARCHMENT_SPACING.md} 0;
        color: ${P.text.muted};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      }

      .auth-divider::before,
      .auth-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: ${P.border};
      }

      .auth-divider span {
        padding: 0 ${PARCHMENT_SPACING.sm};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      @keyframes authShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }

      .version-info {
        position: absolute;
        bottom: 12px;
        right: 16px;
        font-size: 12px;
        color: ${P.text.muted};
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .version-info:hover {
        opacity: 1;
        text-decoration: underline;
      }

      @media (max-width: 600px) {
        .auth-container {
          width: 90%;
          max-width: 340px;
        }

        .auth-input {
          min-height: 44px;
          padding: 12px 14px;
        }

        .auth-btn {
          min-height: 44px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the modal UI and fade it in.
   */
  createModal() {
    if (this.formElement) return; // Already created

    const container = document.createElement('div');
    container.className = 'auth-container';

    const isRegister = this.mode === 'register';
    const emailClass = isRegister ? 'visible' : 'hidden';
    const confirmClass = isRegister ? 'visible' : 'hidden';

    container.innerHTML = `
      <div class="auth-panel" id="auth-panel">
        <div class="auth-panel-header" id="auth-header">${isRegister ? 'Create Account' : 'Welcome Back'}</div>
        <div id="auth-error" class="auth-error" style="display: none;"></div>
        <form id="auth-form">
          <div class="auth-form-group visible">
            <label for="username" class="auth-label">Username</label>
            <input type="text" id="username" class="auth-input"
              placeholder="${isRegister ? '3-32 characters' : 'Enter username'}"
              autocomplete="username" required>
            <div class="auth-field-error" id="username-error"></div>
          </div>

          <div class="auth-form-group ${emailClass}" id="email-group">
            <label for="email" class="auth-label">Email</label>
            <input type="email" id="email" class="auth-input"
              placeholder="your@email.com"
              autocomplete="email" ${isRegister ? 'required' : ''} tabindex="${isRegister ? '0' : '-1'}">
            <div class="auth-field-error" id="email-error"></div>
          </div>

          <div class="auth-form-group visible">
            <label for="password" class="auth-label">Password</label>
            <input type="password" id="password" class="auth-input"
              placeholder="${isRegister ? '8+ characters' : 'Enter password'}"
              autocomplete="${isRegister ? 'new-password' : 'current-password'}" required>
            <div class="auth-field-error" id="password-error"></div>
          </div>

          <div class="auth-form-group ${confirmClass}" id="confirm-group">
            <label for="confirm-password" class="auth-label">Confirm Password</label>
            <input type="password" id="confirm-password" class="auth-input"
              placeholder="Repeat password"
              autocomplete="new-password" ${isRegister ? 'required' : ''} tabindex="${isRegister ? '0' : '-1'}">
            <div class="auth-field-error" id="confirm-password-error"></div>
          </div>

          <button type="submit" class="auth-btn" id="auth-btn">
            ${isRegister ? 'Create Account' : 'Login'}
          </button>
        </form>
        <div class="auth-switch" id="auth-switch">
          ${isRegister ? 'Already have an account? <a id="mode-toggle">Login</a>' : 'Don\'t have an account? <a id="mode-toggle">Register</a>'}
        </div>
        <div class="version-info" id="version-info">v0.4.38</div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.formElement = container;

    // Event listeners
    const form = container.querySelector('#auth-form');
    const modeToggle = container.querySelector('#mode-toggle');

    form.addEventListener('submit', (e) => {
      this.game.audio?.playUI('button_click');
      this.handleSubmit(e);
    });
    modeToggle.addEventListener('click', () => {
      this.game.audio?.playUI('button_click');
      this.toggleMode();
    });

    // Version info click handler
    const versionInfo = container.querySelector('#version-info');
    if (versionInfo) {
      versionInfo.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        if (!this.changelogModal) {
          this.changelogModal = new ChangelogModal();
        }
        this.changelogModal.open();
      });
    }

    // Setup field validation
    this.setupValidation(container);

    // Trigger fade-in after a frame
    requestAnimationFrame(() => {
      container.classList.add('visible');
      // Focus username field after fade starts
      setTimeout(() => {
        container.querySelector('#username').focus();
      }, 100);
    });

    this.modalVisible = true;
  }

  setupValidation(container) {
    const fields = ['username', 'email', 'password', 'confirm-password'];

    fields.forEach(fieldName => {
      const input = container.querySelector(`#${fieldName}`);
      if (!input) return;

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
        if (fieldName === 'password' && this.fieldsTouched['confirm-password'] && this.mode === 'register') {
          this.validateField('confirm-password');
        }
      });
    });
  }

  toggleMode() {
    if (this.transitioning || this.loading) return;
    this.transitioning = true;

    const newMode = this.mode === 'login' ? 'register' : 'login';

    // Clear errors and reset touched state
    this.clearGlobalError();
    this.resetFieldsTouched();
    this.clearAllFieldErrors();

    if (newMode === 'register') {
      // Switch to registration wizard
      this.mode = newMode;
      this.showRegistrationWizard();
      this.transitioning = false;
      return;
    }

    // Switching back to login mode
    // Clean up wizard if it exists
    if (this.wizard) {
      this.wizard.destroy();
      this.wizard = null;
    }

    // Re-create the login modal
    if (this.formElement) {
      this.formElement.remove();
      this.formElement = null;
    }
    this.modalVisible = false;
    this.mode = newMode;
    this.createModal();

    // Allow next toggle after animation completes
    setTimeout(() => {
      this.transitioning = false;
    }, 350);
  }

  clearAllFieldErrors() {
    ['username', 'email', 'password', 'confirm-password'].forEach(field => {
      const input = document.getElementById(field);
      const errorEl = document.getElementById(`${field}-error`);
      if (input) {
        input.classList.remove('input-valid', 'input-invalid');
        input.value = '';
      }
      if (errorEl) {
        errorEl.classList.remove('visible');
        errorEl.textContent = '';
      }
    });
  }

  validateField(fieldName) {
    const input = document.getElementById(fieldName);
    const errorEl = document.getElementById(`${fieldName}-error`);
    if (!input || !errorEl) return true;

    const value = input.value.trim();
    let error = null;

    // Skip validation for hidden fields in login mode
    if (this.mode === 'login' && (fieldName === 'email' || fieldName === 'confirm-password')) {
      return true;
    }

    switch (fieldName) {
      case 'username':
        if (!value) {
          error = 'Username is required';
        } else if (this.mode === 'register') {
          if (value.length < 3) {
            error = 'Username must be at least 3 characters';
          } else if (value.length > 32) {
            error = 'Username must be 32 characters or less';
          } else if (!/^[a-zA-Z0-9_]+$/.test(value)) {
            error = 'Only letters, numbers, and underscores allowed';
          }
        }
        break;

      case 'email':
        if (!value) {
          error = 'Email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          error = 'Please enter a valid email address';
        }
        break;

      case 'password':
        if (!value) {
          error = 'Password is required';
        } else if (this.mode === 'register' && value.length < 8) {
          error = 'Password must be at least 8 characters';
        }
        break;

      case 'confirm-password': {
        const password = document.getElementById('password').value;
        if (!value) {
          error = 'Please confirm your password';
        } else if (value !== password) {
          error = 'Passwords do not match';
        }
        break;
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
    const fields = this.mode === 'register'
      ? ['username', 'email', 'password', 'confirm-password']
      : ['username', 'password'];

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

    if (this.loading || this.transitioning) return;

    if (!this.validateAllFields()) {
      return;
    }

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    this.loading = true;
    this.updateLoadingState();

    try {
      let result;

      if (this.mode === 'register') {
        const email = document.getElementById('email').value.trim();
        result = await this.game.api.register(username, email, password);
      } else {
        result = await this.game.api.login(username, password);
      }

      // Clear any stale state from previous session before storing new auth data
      this.game.state.clear();

      // Store auth data
      this.game.state.set('user', result.user);
      this.game.state.set('token', result.accessToken);
      this.game.state.set('refreshToken', result.refreshToken);
      this.game.state.persist();

      // Start token refresh manager for automatic token refresh
      this.game.tokenRefreshManager.start(result.accessToken);

      // Connect WebSocket
      this.game.socket.connect(result.accessToken);

      // Load user settings
      await this.game.loadSettings();

      // Initialize notification system
      this.game.initNotificationSystem();

      if (this.mode === 'register') {
        // New user goes to character creation wizard
        // Set flag so CharacterCreateScene knows to show the full onboarding flow
        this.game.state.set('isNewRegistration', true);
        this.game.scenes.switchTo('characterCreate');
      } else {
        // Check for active battle first
        try {
          const battleData = await this.game.api.getCurrentBattle();
          this.game.scenes.switchTo('battle', battleData);
        } catch (battleErr) {
          // No active battle - check characters
          const charResult = await this.game.api.getCharacters();
          this.game.state.set('characters', charResult.characters);

          if (charResult.characters.length === 0) {
            this.game.scenes.switchTo('characterCreate');
          } else {
            // Auto-select first character (party leader or first in list)
            const leader = charResult.characters.find(c => c.party_slot === 1) || charResult.characters[0];
            this.game.state.set('activeCharacter', leader);
            this.game.scenes.switchTo('worldMap');
          }
        }
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

    if (message.toLowerCase().includes('username') && message.toLowerCase().includes('taken')) {
      return 'This username is already taken.';
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
      errorEl.style.animation = 'none';
      errorEl.offsetHeight; // Trigger reflow
      errorEl.style.animation = null;
    }
  }

  updateLoadingState() {
    const btn = document.getElementById('auth-btn');
    const panel = document.getElementById('auth-panel');

    if (btn) {
      btn.disabled = this.loading;
      if (this.loading) {
        btn.classList.add('btn-loading');
        btn.textContent = this.mode === 'register' ? 'Creating account...' : 'Logging in...';
      } else {
        btn.classList.remove('btn-loading');
        btn.textContent = this.mode === 'register' ? 'Create Account' : 'Login';
      }
    }

    if (panel) {
      panel.classList.toggle('form-loading', this.loading);
    }
  }

  /**
   * Handle completion of the registration wizard.
   * Sets up auth state and transitions to worldMap.
   * @param {Object} result - Result from wizard containing accessToken, refreshToken, character, user
   */
  handleWizardComplete(result) {
    // Clear any stale state from previous session
    this.game.state.clear();

    // Store auth tokens
    this.game.api.token = result.accessToken;
    localStorage.setItem('refreshToken', result.refreshToken);

    // Store user and token in state
    this.game.state.set('user', result.user);
    this.game.state.set('token', result.accessToken);
    this.game.state.set('refreshToken', result.refreshToken);
    this.game.state.persist();

    // Start token refresh manager
    if (this.game.tokenRefreshManager) {
      this.game.tokenRefreshManager.start(result.accessToken);
    }

    // Connect WebSocket
    if (this.game.socket) {
      this.game.socket.connect(result.accessToken);
    }

    // Set the active character
    this.game.state.set('activeCharacter', result.character);

    // Initialize notification system
    this.game.initNotificationSystem();

    // Load settings then transition to world map
    this.game.loadSettings().then(() => {
      this.game.scenes.switchTo('worldMap');
    }).catch(() => {
      // Even if settings fail to load, still transition
      this.game.scenes.switchTo('worldMap');
    });
  }

  /**
   * Show the registration wizard, hiding the login modal.
   */
  showRegistrationWizard() {
    // Hide and remove the login modal if it exists
    if (this.formElement) {
      this.formElement.remove();
      this.formElement = null;
    }
    this.modalVisible = false;

    // Create wizard container
    const wizardContainer = document.createElement('div');
    wizardContainer.className = 'auth-container visible';
    wizardContainer.style.width = 'auto';
    wizardContainer.style.maxWidth = '900px';
    this.game.uiOverlay.appendChild(wizardContainer);

    // Store reference so we can clean up
    this.formElement = wizardContainer;

    // Instantiate the wizard
    this.wizard = new RegistrationWizard(
      this.game,
      wizardContainer,
      (result) => this.handleWizardComplete(result)
    );

    this.modalVisible = true;
  }

  update(deltaTime) {
    if (!this.transitionRenderer) return;

    // Update transition
    this.transitionRenderer.update(deltaTime);

    // Create modal once transition is ready and font is loaded
    if (!this.modalVisible &&
        this.transitionRenderer.isReadyForModal() &&
        this.fontLoaded) {
      this.createModal();
    }
  }

  render(ctx) {
    if (this.transitionRenderer) {
      this.transitionRenderer.render(ctx);
    }
  }
}
