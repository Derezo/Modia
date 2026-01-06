import { Scene } from './Scene.js';

export class RegisterScene extends Scene {
  constructor(game) {
    super(game);
    this.formElement = null;
    this.loading = false;
  }

  enter() {
    this.loading = false;
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
      <div class="ui-panel">
        <div class="ui-panel-header">Create Account</div>
        <div id="auth-error" class="auth-error" style="display: none;"></div>
        <form id="register-form">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" class="input-field" placeholder="3-32 characters" autocomplete="username" required minlength="3" maxlength="32">
          </div>
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" class="input-field" placeholder="your@email.com" autocomplete="email" required>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" class="input-field" placeholder="8+ characters" autocomplete="new-password" required minlength="8">
          </div>
          <div class="form-group">
            <label for="confirm-password">Confirm Password</label>
            <input type="password" id="confirm-password" class="input-field" placeholder="Repeat password" autocomplete="new-password" required>
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

    container.querySelector('#username').focus();
  }

  async handleSubmit(e) {
    e.preventDefault();

    if (this.loading) return;

    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    // Validation
    if (password !== confirmPassword) {
      this.showError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      this.showError('Password must be at least 8 characters');
      return;
    }

    this.loading = true;
    this.updateButtonState();

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
      this.showError(err.message);
    } finally {
      this.loading = false;
      this.updateButtonState();
    }
  }

  showError(message) {
    const errorEl = document.getElementById('auth-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  }

  updateButtonState() {
    const btn = document.getElementById('register-btn');
    if (btn) {
      btn.disabled = this.loading;
      btn.textContent = this.loading ? 'Creating account...' : 'Register';
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
