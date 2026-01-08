require('dotenv').config({ path: '../.env' });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { setupWebSocket } = require('./websocket');
const { errorHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');

// Routes
const authRoutes = require('./routes/auth');
const characterRoutes = require('./routes/characters');
const partyRoutes = require('./routes/party');
const worldRoutes = require('./routes/world');
const battleRoutes = require('./routes/battle');
const inventoryRoutes = require('./routes/inventory');
const { router: skillsRoutes } = require('./routes/skills');
const spritesRoutes = require('./routes/sprites');
const shopRoutes = require('./routes/shop');
const marketplaceRoutes = require('./routes/marketplace');
const chatRoutes = require('./routes/chat');

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
  crossOriginResourcePolicy: { policy: 'cross-origin' } // Allows sprites to be loaded cross-origin
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
app.use('/api/sprites', spritesRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/chat', chatRoutes);

// Error handling
app.use(errorHandler);

// Setup WebSocket
setupWebSocket(server);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Modia API server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});

module.exports = { app, server };
