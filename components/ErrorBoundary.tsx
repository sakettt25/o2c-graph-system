'use client';

import React, { ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-[#080c14]">
          <div className="text-center space-y-4 max-w-2xl px-4">
            <h1 className="text-xl font-bold text-red-400">Application Error</h1>
            <p className="text-slate-400 text-sm">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <details className="text-left bg-[#0f1419] p-4 rounded border border-red-500/30 max-h-96 overflow-auto">
              <summary className="cursor-pointer text-slate-300 font-mono text-xs">Stack Trace</summary>
              <pre className="text-red-300 text-xs mt-2 font-mono overflow-x-auto">
                {this.state.error?.stack}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
