import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Renders a pixel art castle with towers, walls, gate, and animated flags.
 */
export class CastleRenderer {
  constructor(x, y, scale = 1) {
    this.x = x;
    this.y = y;
    this.scale = scale;

    // Castle dimensions (before scaling)
    this.mainWidth = 200;
    this.mainHeight = 100;
    this.towerWidth = 36;
    this.towerHeight = 140;

    // Animation state
    this.flagPhase = 0;

    // Portcullis state (0 = closed, 1 = open)
    this.portcullisOpen = 0;
  }

  update(deltaTime) {
    // Animate flags
    this.flagPhase += deltaTime * 0.003;
  }

  /**
   * Set portcullis open amount (0-1)
   */
  setPortcullisOpen(amount) {
    this.portcullisOpen = Math.max(0, Math.min(1, amount));
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale, this.scale);

    // Render layers back to front
    this.renderShadow(ctx);
    this.renderMainWall(ctx);
    this.renderTower(ctx, -85, 0, 0);    // Left tower
    this.renderTower(ctx, 85, 0, 0.5);   // Right tower (phase offset)
    this.renderGatehouse(ctx);
    this.renderBattlements(ctx);

    ctx.restore();
  }

  renderShadow(ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 20, 120, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  renderMainWall(ctx) {
    const wallTop = -50;
    const wallHeight = 70;

    // Main wall body
    ctx.fillStyle = TITLE_COLORS.stone.mid;
    ctx.fillRect(-100, wallTop, 200, wallHeight);

    // Stone block pattern (8x8 blocks with offset rows)
    ctx.fillStyle = TITLE_COLORS.stone.dark;
    const blockSize = 10;
    for (let row = 0; row < Math.ceil(wallHeight / blockSize); row++) {
      const offset = (row % 2) * (blockSize / 2);
      for (let col = 0; col < Math.ceil(200 / blockSize); col++) {
        const bx = -100 + col * blockSize + offset;
        const by = wallTop + row * blockSize;
        // Draw mortar lines (gaps between blocks)
        ctx.fillRect(bx + blockSize - 1, by, 1, blockSize);
        ctx.fillRect(bx, by + blockSize - 1, blockSize, 1);
      }
    }

    // Top highlight
    ctx.fillStyle = TITLE_COLORS.stone.light;
    ctx.fillRect(-100, wallTop, 200, 2);

    // Bottom shadow
    ctx.fillStyle = TITLE_COLORS.stone.shadow;
    ctx.fillRect(-100, wallTop + wallHeight - 2, 200, 2);
  }

  renderTower(ctx, offsetX, offsetY, flagPhaseOffset = 0) {
    const towerTop = -120;
    const towerHeight = 140;
    const towerWidth = 36;
    const x = offsetX - towerWidth / 2;

    // Tower body
    ctx.fillStyle = TITLE_COLORS.stone.mid;
    ctx.fillRect(x, towerTop, towerWidth, towerHeight);

    // Stone texture on tower
    ctx.fillStyle = TITLE_COLORS.stone.dark;
    for (let row = 0; row < Math.ceil(towerHeight / 10); row++) {
      const offset = (row % 2) * 5;
      for (let col = 0; col < Math.ceil(towerWidth / 10); col++) {
        const bx = x + col * 10 + offset;
        const by = towerTop + row * 10;
        if (bx < x + towerWidth - 1) {
          ctx.fillRect(bx + 9, by, 1, 10);
        }
        ctx.fillRect(bx, by + 9, 10, 1);
      }
    }

    // Conical roof
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    ctx.beginPath();
    ctx.moveTo(offsetX, towerTop - 25);
    ctx.lineTo(x - 4, towerTop);
    ctx.lineTo(x + towerWidth + 4, towerTop);
    ctx.closePath();
    ctx.fill();

    // Roof highlight
    ctx.fillStyle = TITLE_COLORS.wood.mid;
    ctx.beginPath();
    ctx.moveTo(offsetX, towerTop - 25);
    ctx.lineTo(offsetX + 2, towerTop - 10);
    ctx.lineTo(x + towerWidth + 4, towerTop);
    ctx.lineTo(offsetX, towerTop - 25);
    ctx.fill();

    // Window slit
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(offsetX - 3, towerTop + 35, 6, 18);
    ctx.fillRect(offsetX - 5, towerTop + 42, 10, 4);

    // Tower battlements
    ctx.fillStyle = TITLE_COLORS.stone.mid;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(x + 3 + i * 12, towerTop - 8, 8, 8);
    }

    // Flag
    this.renderFlag(ctx, offsetX, towerTop - 25, this.flagPhase + flagPhaseOffset);
  }

  renderFlag(ctx, x, y, phase) {
    // Flag pole
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    ctx.fillRect(x - 1, y - 25, 3, 30);

    // Pole tip
    ctx.fillStyle = TITLE_COLORS.metal.mid;
    ctx.beginPath();
    ctx.arc(x + 0.5, y - 27, 3, 0, Math.PI * 2);
    ctx.fill();

    // Waving flag using bezier curve
    ctx.fillStyle = TITLE_COLORS.flag.primary;
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 22);

    // Top edge with wave
    const waveAmp = 3;
    const flagLength = 28;
    ctx.bezierCurveTo(
      x + 2 + flagLength * 0.3, y - 22 + Math.sin(phase) * waveAmp,
      x + 2 + flagLength * 0.7, y - 22 + Math.sin(phase + 1) * waveAmp,
      x + 2 + flagLength, y - 22 + Math.sin(phase + 2) * waveAmp
    );

    // Right edge
    ctx.lineTo(x + 2 + flagLength + Math.sin(phase + 2) * 2, y - 10);

    // Bottom edge with wave
    ctx.bezierCurveTo(
      x + 2 + flagLength * 0.7, y - 10 + Math.sin(phase + 1.5) * waveAmp,
      x + 2 + flagLength * 0.3, y - 10 + Math.sin(phase + 0.5) * waveAmp,
      x + 2, y - 10
    );

    ctx.closePath();
    ctx.fill();

    // Flag stripe
    ctx.fillStyle = TITLE_COLORS.flag.secondary;
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 18);
    ctx.bezierCurveTo(
      x + 2 + flagLength * 0.3, y - 18 + Math.sin(phase + 0.3) * waveAmp * 0.7,
      x + 2 + flagLength * 0.7, y - 18 + Math.sin(phase + 1.3) * waveAmp * 0.7,
      x + 2 + flagLength, y - 18 + Math.sin(phase + 2) * waveAmp * 0.7
    );
    ctx.lineTo(x + 2 + flagLength + Math.sin(phase + 2) * 2, y - 14);
    ctx.bezierCurveTo(
      x + 2 + flagLength * 0.7, y - 14 + Math.sin(phase + 1.3) * waveAmp * 0.7,
      x + 2 + flagLength * 0.3, y - 14 + Math.sin(phase + 0.3) * waveAmp * 0.7,
      x + 2, y - 14
    );
    ctx.closePath();
    ctx.fill();
  }

  renderGatehouse(ctx) {
    const gateWidth = 70;
    const gateHeight = 80;
    const gateTop = -60;

    // Gatehouse protrusion
    ctx.fillStyle = TITLE_COLORS.stone.light;
    ctx.fillRect(-gateWidth / 2, gateTop, gateWidth, gateHeight);

    // Stone pattern
    ctx.fillStyle = TITLE_COLORS.stone.mid;
    for (let row = 0; row < 8; row++) {
      const offset = (row % 2) * 5;
      for (let col = 0; col < 7; col++) {
        const bx = -gateWidth / 2 + col * 10 + offset;
        const by = gateTop + row * 10;
        ctx.fillRect(bx + 9, by, 1, 10);
        ctx.fillRect(bx, by + 9, 10, 1);
      }
    }

    // Gate arch (dark interior)
    ctx.fillStyle = '#0a0a1a';
    ctx.beginPath();
    ctx.moveTo(-22, gateTop + gateHeight);
    ctx.lineTo(-22, gateTop + 30);
    ctx.quadraticCurveTo(-22, gateTop + 15, 0, gateTop + 15);
    ctx.quadraticCurveTo(22, gateTop + 15, 22, gateTop + 30);
    ctx.lineTo(22, gateTop + gateHeight);
    ctx.closePath();
    ctx.fill();

    // Portcullis (if not fully open)
    if (this.portcullisOpen < 1) {
      const portcullisY = gateTop + 15 + (this.portcullisOpen * 40);
      ctx.strokeStyle = TITLE_COLORS.wood.dark;
      ctx.lineWidth = 2;

      // Vertical bars
      for (let i = -18; i <= 18; i += 9) {
        ctx.beginPath();
        ctx.moveTo(i, portcullisY);
        ctx.lineTo(i, gateTop + gateHeight);
        ctx.stroke();
      }

      // Horizontal bars
      for (let j = portcullisY + 8; j < gateTop + gateHeight; j += 10) {
        ctx.beginPath();
        ctx.moveTo(-20, j);
        ctx.lineTo(20, j);
        ctx.stroke();
      }
    }

    // Arch border
    ctx.strokeStyle = TITLE_COLORS.stone.darkest;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-24, gateTop + gateHeight);
    ctx.lineTo(-24, gateTop + 30);
    ctx.quadraticCurveTo(-24, gateTop + 13, 0, gateTop + 13);
    ctx.quadraticCurveTo(24, gateTop + 13, 24, gateTop + 30);
    ctx.lineTo(24, gateTop + gateHeight);
    ctx.stroke();
  }

  renderBattlements(ctx) {
    // Main wall battlements (crenellations)
    ctx.fillStyle = TITLE_COLORS.stone.mid;
    const crenelWidth = 14;
    const crenelHeight = 10;
    const gap = 8;

    // Left section (before gatehouse)
    for (let i = -95; i < -38; i += crenelWidth + gap) {
      ctx.fillRect(i, -60, crenelWidth, crenelHeight);
    }

    // Right section (after gatehouse)
    for (let i = 38; i < 95; i += crenelWidth + gap) {
      ctx.fillRect(i, -60, crenelWidth, crenelHeight);
    }

    // Gatehouse battlements
    for (let i = -30; i <= 18; i += crenelWidth + gap) {
      ctx.fillRect(i, -70, crenelWidth, crenelHeight);
    }
  }
}
