import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

// Load .env from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { setupWebSocket } from './websocket/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { resetAllRateLimiters, isProduction } from './middleware/rateLimiterFactory.js';

// Routes
import authRoutes from './routes/auth.js';
import characterRoutes from './routes/characters.js';
import partyRoutes from './routes/party.js';
import worldRoutes from './routes/world.js';
import battleRoutes from './routes/battle.js';
import inventoryRoutes from './routes/inventory.js';
import { router as skillsRoutes } from './routes/skills.js';
import shopRoutes from './routes/shop.js';
import marketplaceRoutes from './routes/marketplace.js';
import chatRoutes from './routes/chat.js';
import guildRoutes from './routes/guild.js';
import settingsRoutes from './routes/settings.js';
import notificationRoutes from './routes/notifications.js';
import lfgRoutes from './routes/lfg.js';
import friendRoutes from './routes/friends.js';
import coliseumRoutes from './routes/coliseum.js';
import leaderboardRoutes from './routes/leaderboard.js';
import advancementQuestRoutes from './routes/advancementQuest.js';
import clanRoutes from './routes/clans.js';
import ruinsRoutes from './routes/ruins.js';
import fishingRoutes from './routes/fishing.js';
import relicRoutes from './routes/relics.js';
import questRoutes from './routes/quests.js';
import debugRoutes from './routes/debug.js';
import healthRoutes from './routes/health.js';

// Scheduled services
import { startRefreshScheduler } from './services/shopRefreshService.js';
import { startExpirationScheduler } from './services/orderExpirationService.js';
import { startCleanupScheduler as startQuestCleanupScheduler } from './services/dailyQuestService.js';

// Trait effects system
import { initializeTraitEffects } from './services/traits/index.js';

const app = express();
const server = http.createServer(app);

// SECURITY: Enable trust proxy for proper IP detection behind nginx/reverse proxy
// Without this, req.ip returns proxy IP (127.0.0.1) instead of real client IP
// Set to 1 to trust first hop, or 'loopback' for local reverse proxy
app.set('trust proxy', process.env.TRUST_PROXY || 1);

// SECURITY: Parse CORS origins from environment variable or use defaults
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:8080', 'http://localhost:3000', 'http://127.0.0.1:8080'];

// SECURITY: Helmet middleware for security headers
// Configured for API-only server (no CSP needed for API responses)
app.use(helmet({
  contentSecurityPolicy: false, // Not needed for API-only server
  crossOriginEmbedderPolicy: false, // Allows CORS to work properly
  crossOriginResourcePolicy: { policy: 'cross-origin' } // Allows assets to be loaded cross-origin
}));

// Middleware
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' })); // SECURITY: Limit request body size
app.use(rateLimiter);

// Health check (three-tier: /, /ready, /metrics)
app.use('/api/health', healthRoutes);

// Test utility endpoint to reset rate limiters (non-production only)
if (!isProduction) {
  app.post('/api/test/reset-rate-limiters', async (req, res) => {
    const success = await resetAllRateLimiters();
    if (success) {
      res.json({ status: 'ok', message: 'Rate limiters reset' });
    } else {
      res.status(403).json({ error: 'Rate limiter reset not available' });
    }
  });
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/party', partyRoutes);
app.use('/api/world', worldRoutes);
app.use('/api/battle', battleRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/guild', guildRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/lfg', lfgRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/players', friendRoutes); // Player search endpoint
app.use('/api/coliseum', coliseumRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/advancement', advancementQuestRoutes);
app.use('/api/clans', clanRoutes);
app.use('/api/ruins', ruinsRoutes);
app.use('/api/fishing', fishingRoutes);
app.use('/api/relics', relicRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/debug', debugRoutes);

// Error handling
app.use(errorHandler);

// Setup WebSocket
setupWebSocket(server);

// Initialize trait effects system
initializeTraitEffects();

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Modia API server running on port ${PORT}`);
  console.log('WebSocket server ready');

  // Start scheduled services
  startRefreshScheduler();
  startExpirationScheduler();
  startQuestCleanupScheduler();
});

export { app, server };
