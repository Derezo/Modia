import { Scene } from './Scene.js';

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
    this.createUI();
  }

  exit() {
    if (this.formElement) {
      this.formElement.remove();
      this.formElement = null;
    }
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'auth-container';
    container.innerHTML = `
      <h1 class="auth-title">Modia</h1>
      <div class="ui-panel" id="login-panel">
        <div id="auth-error" class="auth-error" style="display: none;"></div>
        <form id="login-form">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" class="input-field" placeholder="Enter username" autocomplete="username" required>
            <div class="field-error" id="username-error"></div>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" class="input-field" placeholder="Enter password" autocomplete="current-password" required>
            <div class="field-error" id="password-error"></div>
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%;" id="login-btn">Login</button>
        </form>
        <div class="auth-switch">
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
    // Draw background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, '#16213e');
    gradient.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw some decorative elements
    ctx.fillStyle = 'rgba(255, 215, 0, 0.05)';
    for (let i = 0; i < 5; i++) {
      const x = 100 + i * 150;
      const y = 450 + Math.sin(Date.now() / 1000 + i) * 20;
      ctx.beginPath();
      ctx.arc(x, y, 30 + i * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
