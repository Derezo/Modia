/**
 * File Logger for VPS Integration
 * Writes structured JSON logs to files with daily rotation
 *
 * Log files are written to LOG_DIR (default: ./logs)
 * Filename pattern: modia-errors-YYYY-MM-DD.log
 *
 * Each log entry is a JSON object on a single line for easy parsing:
 * {
 *   "timestamp": "2026-01-26T10:30:00.000Z",
 *   "level": "error",
 *   "requestId": "abc12345-...",
 *   "fingerprint": "sha256hash...",
 *   "exception": { "type", "message", "stack" },
 *   "request": { "method", "url", "userId", "ip" }
 * }
 */

import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const LOG_DIR = process.env.LOG_DIR || './logs';
const FILE_LOGGING_ENABLED = process.env.FILE_LOGGING_ENABLED !== 'false';

// Track current log file to avoid date calculation on every write
let currentLogFile = null;
let currentDate = null;

/**
 * Get the log file path for the current date
 * Creates the directory if it doesn't exist
 */
async function getLogFilePath() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Return cached path if date hasn't changed
  if (currentDate === today && currentLogFile) {
    return currentLogFile;
  }

  // Ensure log directory exists
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, { recursive: true });
  }

  currentDate = today;
  currentLogFile = join(LOG_DIR, `modia-errors-${today}.log`);
  return currentLogFile;
}

/**
 * Write a structured log entry to the file
 *
 * @param {Object} entry - Log entry object
 */
async function writeLogEntry(entry) {
  if (!FILE_LOGGING_ENABLED) return;

  try {
    const logFile = await getLogFilePath();
    const line = JSON.stringify(entry) + '\n';
    await appendFile(logFile, line, 'utf8');
  } catch (err) {
    // Don't let file logging errors crash the app
    console.error('[FileLogger] Failed to write log:', err.message);
  }
}

/**
 * Log an exception with full context
 * Called from the logger utility for error-level logs
 *
 * @param {Object} options - Log options
 * @param {Error} options.error - The error object
 * @param {Object} options.req - Express request (optional)
 * @param {string} options.fingerprint - Error fingerprint (optional)
 * @param {Object} options.context - Additional context (optional)
 */
export async function logException({ error, req, fingerprint, context = {} }) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    requestId: req?.requestId || null,
    fingerprint: fingerprint || null,
    exception: {
      type: error?.name || error?.constructor?.name || 'Error',
      message: error?.message || String(error),
      stack: error?.stack || null
    },
    request: req ? {
      method: req.method,
      url: req.originalUrl || req.url,
      userId: req.user?.id || null,
      ip: req.ip || null,
      userAgent: req.get?.('user-agent') || null
    } : null,
    context: Object.keys(context).length > 0 ? context : undefined,
    environment: process.env.NODE_ENV || 'development'
  };

  await writeLogEntry(entry);
}

/**
 * Log an informational event
 *
 * @param {string} level - Log level (info, warn, debug)
 * @param {string} message - Log message
 * @param {Object} data - Additional data
 */
export async function logEvent(level, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
    environment: process.env.NODE_ENV || 'development'
  };

  await writeLogEntry(entry);
}

/**
 * Check if file logging is enabled
 */
export function isFileLoggingEnabled() {
  return FILE_LOGGING_ENABLED;
}

/**
 * Get the current log directory
 */
export function getLogDirectory() {
  return LOG_DIR;
}
