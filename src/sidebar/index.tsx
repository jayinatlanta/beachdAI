// src/sidebar/index.tsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import Sidebar from './Sidebar';

// --- Simple Error Boundary Component ---
class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, { hasError: boolean }> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // You can also log the error to an error reporting service
    console.error("Uncaught error in sidebar:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div style={{ padding: '16px', color: 'red' }}>
          <h1>Something went wrong.</h1>
          <p>An error occurred in the UI. Check the console for details and try reloading the extension.</p>
        </div>
      );
    }

    return this.props.children; 
  }
}


// Find the root element in sidebar.html
const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// Render the main Sidebar component, wrapped in our new Error Boundary
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <Sidebar />
    </ErrorBoundary>
  </React.StrictMode>
);
