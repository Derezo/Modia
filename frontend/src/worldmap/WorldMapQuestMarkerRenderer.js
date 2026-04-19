import { responsive } from '../core/Responsive.js';
import { QuestMarkerManager } from './QuestMarkerManager.js';

/**
 * Renders quest markers on nodes that have active quest objectives
 * Markers are small colored badges positioned above/to-the-side of nodes
 */
export class WorldMapQuestMarkerRenderer {
  /**
   * @param {Object} scene - WorldMapScene instance
   */
  constructor(scene) {
    this.scene = scene;
  }

  /**
   * Render all quest markers on visible nodes
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  render(ctx) {
    const {
      questMarkerManager,
      nodes,
      nodeSpacing,
      cameraX,
      cameraY,
      pathSystem,
      game
    } = this.scene;

    if (!questMarkerManager) return;

    for (const node of nodes) {
      // Skip nodes without markers
      if (!questMarkerManager.hasMarker(node.id)) continue;

      // Skip nodes that are not reachable
      if (!pathSystem.isNodeReachable(node.id)) continue;

      const x = node.x_coord * nodeSpacing + cameraX;
      const y = node.y_coord * nodeSpacing + cameraY;

      // Skip if off screen
      if (x < -50 || x > game.targetWidth + 50 || y < -50 || y > game.targetHeight + 50) {
        continue;
      }

      const marker = questMarkerManager.getMarkerForNode(node.id);
      this.renderMarkerBadge(ctx, x, y, marker, node);
    }
  }

  /**
   * Render a quest marker badge at a node position
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} x - Node X position (screen coords)
   * @param {number} y - Node Y position (screen coords)
   * @param {Object} marker - Marker data from QuestMarkerManager
   * @param {Object} node - Node object for sprite lookup
   */
  renderMarkerBadge(ctx, x, y, marker, node) {
    if (!marker) return;

    const badges = QuestMarkerManager.getBadgeColors(marker);
    if (badges.length === 0) return;

    const { nodeRenderer, nodeSize } = this.scene;

    // Position badges above and to the right of the node
    const nodeSprite = node ? nodeRenderer.getNodeSprite(node.node_type) : null;
    const spriteSize = nodeSprite ? nodeRenderer.getNodeSpriteSize(node.node_type) : nodeSize;
    const badgeRadius = 5;
    const badgeSpacing = 4;
    const startX = x + spriteSize / 2 - 4;
    const startY = y - spriteSize / 2 - 4;

    ctx.save();

    // Draw each badge (max 3, with overlap)
    for (let i = 0; i < Math.min(badges.length, 3); i++) {
      const badgeX = startX - i * badgeSpacing;
      const badgeY = startY;
      const color = badges[i];

      // Badge background with glow
      if (marker.nearComplete) {
        // Pulse glow for near-complete quests (convert hex color to rgba)
        const pulse = 0.4 + Math.sin(Date.now() * 0.005) * 0.3;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius + 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pulse})`;
        ctx.fill();
      }

      // Badge circle
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Badge border
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Inner highlight
      ctx.beginPath();
      ctx.arc(badgeX - 1, badgeY - 1, badgeRadius - 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Show "+N" indicator if more than 3 quests
    if (marker.questCount > 3) {
      const extraX = startX - 3 * badgeSpacing - 8;
      const extraY = startY;

      ctx.font = `bold ${responsive.getCanvasFontSize('sm')}px Arial`;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const text = `+${marker.questCount - 3}`;
      ctx.strokeText(text, extraX, extraY);
      ctx.fillText(text, extraX, extraY);
    }

    ctx.restore();
  }
}
