import { Scene } from './Scene.js';

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
      <div class="ui-panel" id="register-panel">
        <div class="ui-panel-header">Create Account</div>
        <div id="auth-error" class="auth-error" style="display: none;"></div>
        <form id="register-form">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" class="input-field" placeholder="3-32 characters" autocomplete="username" required minlength="3" maxlength="32">
            <div class="field-error" id="username-error"></div>
          </div>
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" class="input-field" placeholder="your@email.com" autocomplete="email" required>
            <div class="field-error" id="email-error"></div>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" class="input-field" placeholder="8+ characters" autocomplete="new-password" required minlength="8">
            <div class="field-error" id="password-error"></div>
          </div>
          <div class="form-group">
            <label for="confirm-password">Confirm Password</label>
            <input type="password" id="confirm-password" class="input-field" placeholder="Repeat password" autocomplete="new-password" required>
            <div class="field-error" id="confirm-password-error"></div>
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%;" id="register-btn">Register</button>
        </form>
        <div class="auth-switch">
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
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, '#16213e');
    gradient.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
