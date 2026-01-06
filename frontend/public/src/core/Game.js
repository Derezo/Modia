import { StateManager } from './StateManager.js';
import { SceneManager } from './SceneManager.js';
import { InputHandler } from './InputHandler.js';
import { ApiClient } from '../api/client.js';
import { GameWebSocket } from '../api/websocket.js';

export class Game {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.uiOverlay = null;

    this.state = new StateManager();
    this.scenes = null;
    this.input = null;
    this.api = null;
    this.socket = null;

    this.lastTime = 0;
    this.running = false;

    // Target dimensions (will be scaled to fit screen)
    this.targetWidth = 800;
    this.targetHeight = 600;
    this.scale = 1;
  }

  init() {
    // Get canvas and context
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.uiOverlay = document.getElementById('ui-overlay');

    // Initialize subsystems
    this.api = new ApiClient('/api');
    this.socket = new GameWebSocket(this.getWebSocketUrl());
    this.input = new InputHandler(this.canvas);
    this.scenes = new SceneManager(this);

    // Setup canvas sizing
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Hydrate state from localStorage
    this.state.hydrate();

    // Check for existing session
    this.checkSession();

    // Start game loop
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((time) => this.gameLoop(time));

    console.log('Modia initialized');
  }

  getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.hostname === 'localhost' ? ':3000' : '';
    return `${protocol}//${host}${port}/ws`;
  }

  async checkSession() {
    const token = this.state.get('token');

    if (token) {
      try {
        const response = await this.api.get('/auth/me');
        this.state.set('user', response.user);
        this.scenes.switchTo('worldMap');

        // Connect WebSocket
        this.socket.connect(token);
      } catch (err) {
        // Token invalid, clear and show login
        this.state.set('token', null);
        this.state.set('user', null);
        this.state.persist();
        this.scenes.switchTo('login');
      }
    } else {
      this.scenes.switchTo('login');
    }
  }

  resize() {
    const container = this.canvas.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Calculate scale to fit target dimensions
    const scaleX = containerWidth / this.targetWidth;
    const scaleY = containerHeight / this.targetHeight;
    this.scale = Math.min(scaleX, scaleY);

    // Set canvas size
    this.canvas.width = this.targetWidth;
    this.canvas.height = this.targetHeight;

    // Scale canvas with CSS
    this.canvas.style.width = `${this.targetWidth * this.scale}px`;
    this.canvas.style.height = `${this.targetHeight * this.scale}px`;

    // Update input handler scale
    if (this.input) {
      this.input.setScale(this.scale);
    }
  }

  gameLoop(currentTime) {
    if (!this.running) return;

    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    // Update current scene
    this.scenes.update(deltaTime);

    // Render
    this.render();

    requestAnimationFrame((time) => this.gameLoop(time));
  }

  render() {
    // Clear canvas
    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Render current scene
    this.scenes.render(this.ctx);
  }

  // Convenience methods for scenes
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'error' ? '#d94a4a' : type === 'success' ? '#4caf50' : '#4a90d9'};
      color: white;
      border-radius: 4px;
      font-size: 14px;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}
