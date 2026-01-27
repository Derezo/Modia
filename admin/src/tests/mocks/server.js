/**
 * MSW Server Setup
 * Configures the mock service worker server for Node.js tests
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// Create the mock server with default handlers
export const server = setupServer(...handlers);

export default server;
