/**
 * ToastContext - Global toast notification system
 *
 * Provides toast notifications for success, error, and info messages.
 * Toasts auto-dismiss after 4 seconds and stack in bottom-right corner.
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  CheckCircledIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  Cross2Icon,
} from '@radix-ui/react-icons';

const ToastContext = createContext(null);

/**
 * Toast duration in milliseconds
 */
const TOAST_DURATION = 4000;

/**
 * Exit animation duration in milliseconds
 */
const EXIT_ANIMATION_DURATION = 200;

/**
 * Single toast component
 */
function Toast({ toast, onDismiss }) {
  const [isExiting, setIsExiting] = useState(false);
  const exitTimerRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      exitTimerRef.current = setTimeout(() => onDismiss(toast.id), EXIT_ANIMATION_DURATION);
    }, TOAST_DURATION);

    return () => {
      clearTimeout(timer);
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
      }
    };
  }, [toast.id, onDismiss]);

  const handleDismiss = () => {
    // Clear auto-dismiss timers when manually dismissed
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
    }
    setIsExiting(true);
    exitTimerRef.current = setTimeout(() => onDismiss(toast.id), EXIT_ANIMATION_DURATION);
  };

  const icons = {
    success: <CheckCircledIcon className="w-5 h-5 text-accent-emerald flex-shrink-0" />,
    error: <ExclamationTriangleIcon className="w-5 h-5 text-accent-ruby flex-shrink-0" />,
    info: <InfoCircledIcon className="w-5 h-5 text-accent-sapphire flex-shrink-0" />,
  };

  const colors = {
    success: 'border-accent-emerald/30 bg-accent-emerald/10',
    error: 'border-accent-ruby/30 bg-accent-ruby/10',
    info: 'border-accent-sapphire/30 bg-accent-sapphire/10',
  };

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg border shadow-lg
        transition-all duration-200 min-w-[300px] max-w-[400px]
        bg-midnight-900 ${colors[toast.type] || colors.info}
        ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
    >
      {icons[toast.type] || icons.info}
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-medium text-parchment-100">{toast.title}</p>
        )}
        <p className={`text-sm ${toast.title ? 'text-parchment-400' : 'text-parchment-200'}`}>
          {toast.message}
        </p>
      </div>
      <button
        onClick={handleDismiss}
        className="p-1 text-parchment-500 hover:text-parchment-200 transition-colors flex-shrink-0"
        aria-label="Dismiss notification"
      >
        <Cross2Icon className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Toast container component
 */
function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/**
 * Toast provider component
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idCounter = useRef(0);

  const addToast = useCallback((type, message, title = null) => {
    const id = ++idCounter.current;
    setToasts((prev) => [...prev, { id, type, message, title }]);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Create stable toast function with method shortcuts
  const toastFn = useMemo(() => {
    const fn = (message, options = {}) => {
      const { type = 'info', title = null } = options;
      return addToast(type, message, title);
    };
    fn.success = (message, title) => addToast('success', message, title);
    fn.error = (message, title) => addToast('error', message, title);
    fn.info = (message, title) => addToast('info', message, title);
    return fn;
  }, [addToast]);

  return (
    <ToastContext.Provider value={toastFn}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

/**
 * Hook to use toast notifications
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Asset saved');
 *   toast.error('Failed to generate');
 *   toast.info('Backup restored');
 *   toast('Custom message', { type: 'success', title: 'Title' });
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
