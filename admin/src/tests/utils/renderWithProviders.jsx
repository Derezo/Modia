/**
 * Render Utilities for Testing
 * Wraps components with required providers for testing
 */

import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '../../contexts/ToastContext';

/**
 * Default providers for testing
 */
function AllTheProviders({ children }) {
  return (
    <BrowserRouter>
      <ToastProvider>
        {children}
      </ToastProvider>
    </BrowserRouter>
  );
}

/**
 * Custom render that includes providers
 * @param {React.ReactElement} ui - Component to render
 * @param {object} options - Render options
 * @returns {object} Render result with all RTL queries
 */
export function renderWithProviders(ui, options = {}) {
  const { wrapper: Wrapper, ...renderOptions } = options;

  // Combine custom wrapper with default providers
  const FinalWrapper = Wrapper
    ? ({ children }) => (
        <AllTheProviders>
          <Wrapper>{children}</Wrapper>
        </AllTheProviders>
      )
    : AllTheProviders;

  return render(ui, { wrapper: FinalWrapper, ...renderOptions });
}

/**
 * Custom render with router at specific path
 * @param {React.ReactElement} ui - Component to render
 * @param {string} initialPath - Initial router path
 * @param {object} options - Render options
 */
export function renderWithRouter(ui, initialPath = '/', options = {}) {
  window.history.pushState({}, 'Test page', initialPath);
  return renderWithProviders(ui, options);
}

/**
 * Re-export everything from @testing-library/react
 */
export * from '@testing-library/react';

export default renderWithProviders;
