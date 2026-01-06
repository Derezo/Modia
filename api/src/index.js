require('dotenv').config({ path: '../.env' });

const express = require('express');
const cors = require('cors');
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
const skillsRoutes = require('./routes/skills');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
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
