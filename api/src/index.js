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

// Scheduled services
import { startRefreshScheduler } from './services/shopRefreshService.js';
import { startExpirationScheduler } from './services/orderExpirationService.js';

const app = express();
const server = http.createServer(app);

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

// Error handling
app.use(errorHandler);

// Setup WebSocket
setupWebSocket(server);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Modia API server running on port ${PORT}`);
  console.log(`WebSocket server ready`);

  // Start scheduled services
  startRefreshScheduler();
  startExpirationScheduler();
});

export { app, server };
