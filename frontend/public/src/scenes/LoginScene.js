import { Scene } from './Scene.js';

export class LoginScene extends Scene {
  constructor(game) {
    super(game);
    this.formElement = null;
    this.error = null;
    this.loading = false;
  }

  enter() {
    this.error = null;
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
        <div id="auth-error" class="auth-error" style="display: none;"></div>
        <form id="login-form">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" class="input-field" placeholder="Enter username" autocomplete="username" required>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" class="input-field" placeholder="Enter password" autocomplete="current-password" required>
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

    form.addEventListener('submit', (e) => this.handleSubmit(e));
    registerLink.addEventListener('click', () => this.game.scenes.switchTo('register'));

    // Focus username field
    container.querySelector('#username').focus();
  }

  async handleSubmit(e) {
    e.preventDefault();

    if (this.loading) return;

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
      this.showError('Please enter username and password');
      return;
    }

    this.loading = true;
    this.updateButtonState();

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

      // Load characters and go to appropriate screen
      const charResult = await this.game.api.getCharacters();
      this.game.state.set('characters', charResult.characters);

      if (charResult.characters.length === 0) {
        this.game.scenes.switchTo('characterCreate');
      } else {
        this.game.scenes.switchTo('worldMap');
      }
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
    const btn = document.getElementById('login-btn');
    if (btn) {
      btn.disabled = this.loading;
      btn.textContent = this.loading ? 'Logging in...' : 'Login';
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
