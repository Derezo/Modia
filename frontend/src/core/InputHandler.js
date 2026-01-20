export class InputHandler {
  constructor(canvas) {
    this.canvas = canvas;
    this.scale = 1;

    // Mouse state
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.mouseClicked = false;

    // Touch state
    this.touchX = 0;
    this.touchY = 0;
    this.touching = false;
    this.touchTapped = false;

    // Keyboard state
    this.keys = new Set();
    this.keysPressed = new Set();

    // Bound handler references for cleanup (window-level listeners)
    this._boundKeyDown = null;
    this._boundKeyUp = null;

    // Event listeners
    this.setupMouseEvents();
    this.setupTouchEvents();
    this.setupKeyboardEvents();
  }

  setScale(scale) {
    this.scale = scale;
  }

  getCanvasCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.scale,
      y: (clientY - rect.top) / this.scale
    };
  }

  setupMouseEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      const coords = this.getCanvasCoords(e.clientX, e.clientY);
      this.mouseX = coords.x;
      this.mouseY = coords.y;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true;
      const coords = this.getCanvasCoords(e.clientX, e.clientY);
      this.mouseX = coords.x;
      this.mouseY = coords.y;
    });

    this.canvas.addEventListener('mouseup', (_e) => {
      if (this.mouseDown) {
        this.mouseClicked = true;
      }
      this.mouseDown = false;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.mouseDown = false;
    });
  }

  setupTouchEvents() {
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const coords = this.getCanvasCoords(touch.clientX, touch.clientY);
      this.touchX = coords.x;
      this.touchY = coords.y;
      this.touching = true;
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const coords = this.getCanvasCoords(touch.clientX, touch.clientY);
      this.touchX = coords.x;
      this.touchY = coords.y;
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (this.touching) {
        this.touchTapped = true;
      }
      this.touching = false;
    }, { passive: false });
  }

  setupKeyboardEvents() {
    this._boundKeyDown = (e) => {
      if (!this.keys.has(e.code)) {
        this.keysPressed.add(e.code);
      }
      this.keys.add(e.code);
    };

    this._boundKeyUp = (e) => {
      this.keys.delete(e.code);
    };

    window.addEventListener('keydown', this._boundKeyDown);
    window.addEventListener('keyup', this._boundKeyUp);
  }

  /**
   * Clean up window-level event listeners to prevent memory leaks
   * Note: Canvas listeners are automatically cleaned up when the canvas is removed from DOM
   */
  destroy() {
    if (this._boundKeyDown) {
      window.removeEventListener('keydown', this._boundKeyDown);
      this._boundKeyDown = null;
    }
    if (this._boundKeyUp) {
      window.removeEventListener('keyup', this._boundKeyUp);
      this._boundKeyUp = null;
    }
  }

  // Check if a point is within a rectangle
  isPointInRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
  }

  // Check if mouse/touch clicked within a rectangle
  isClickedInRect(rx, ry, rw, rh) {
    if (this.mouseClicked) {
      return this.isPointInRect(this.mouseX, this.mouseY, rx, ry, rw, rh);
    }
    if (this.touchTapped) {
      return this.isPointInRect(this.touchX, this.touchY, rx, ry, rw, rh);
    }
    return false;
  }

  // Check if mouse/touch is hovering over a rectangle
  isHoveringRect(rx, ry, rw, rh) {
    return this.isPointInRect(this.mouseX, this.mouseY, rx, ry, rw, rh);
  }

  // Check if a key is currently held
  isKeyDown(code) {
    return this.keys.has(code);
  }

  // Check if a key was just pressed (only true for one frame)
  isKeyPressed(code) {
    return this.keysPressed.has(code);
  }

  // Clear single-frame states (call at end of update)
  clearFrameState() {
    this.mouseClicked = false;
    this.touchTapped = false;
    this.keysPressed.clear();
  }

  // Get current pointer position (mouse or touch)
  getPointerPosition() {
    if (this.touching) {
      return { x: this.touchX, y: this.touchY };
    }
    return { x: this.mouseX, y: this.mouseY };
  }
}
