/**
 * Logger utility for Modia API
 * Provides structured, single-line logging with DEBUG mode toggle
 */

const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * Format SQL query for single-line output
 * Collapses whitespace and trims
 */
function formatSQL(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

/**
 * Safely stringify parameters, handling circular refs and large objects
 */
function formatParams(params) {
  if (!params || params.length === 0) return '';
  try {
    const str = JSON.stringify(params);
    // Truncate very long param strings (e.g., large JSON blobs)
    return str.length > 200 ? str.substring(0, 200) + '...' : str;
  } catch {
    return '[circular]';
  }
}

export const logger = {
  /**
   * Log a database query (only in DEBUG mode)
   * Format: [DB] sql params=[...] duration=Xms rows=Y
   */
  query(sql, params, duration, rowCount) {
    if (!DEBUG) return;
    const paramStr = params?.length ? ` params=${formatParams(params)}` : '';
    console.log(`[DB] ${formatSQL(sql)}${paramStr} duration=${duration}ms rows=${rowCount}`);
  },

  /**
   * Log an error with context
   * Always logs regardless of DEBUG mode
   */
  error(context, error) {
    const ctx = typeof context === 'string' ? context : JSON.stringify(context);
    console.error(`[ERROR] ${ctx} message="${error?.message || error}"`);
    if (DEBUG && error?.stack) {
      // Show first 5 lines of stack trace, joined on single line
      const stackLines = error.stack.split('\n').slice(0, 5).join(' | ');
      console.error(`[STACK] ${stackLines}`);
    }
  },

  /**
   * Log informational message
   * Always logs regardless of DEBUG mode
   */
  info(context, message) {
    console.log(`[INFO] ${context} ${message}`);
  },

  /**
   * Log debug message (only in DEBUG mode)
   */
  debug(context, message, data) {
    if (!DEBUG) return;
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`[DEBUG] ${context} ${message}${dataStr}`);
  },

  /**
   * Log a warning
   * Always logs regardless of DEBUG mode
   */
  warn(context, message) {
    console.warn(`[WARN] ${context} ${message}`);
  },

  /**
   * Check if debug mode is enabled
   */
  isDebug() {
    return DEBUG;
  }
};
