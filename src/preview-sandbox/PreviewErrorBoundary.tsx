// PreviewErrorBoundary.tsx — React Error Boundary for the in-house preview sandbox.
// Catches runtime React render exceptions in user code and layouts,
// presents diagnostic UI with error message and component stack, provides
// a Retry button, notifies parent window via `preview:render-error`,
// and resets automatically on route/revision change.

import * as React from 'react';

let renderErrorActive = false;

export function isPreviewRenderErrorActive(): boolean {
  return renderErrorActive;
}

export function setPreviewRenderErrorActive(active: boolean): void {
  renderErrorActive = active;
}

export interface PreviewErrorBoundaryProps {
  url: string;
  revision?: number;
  children: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
}

export interface PreviewErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class PreviewErrorBoundary extends React.Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  override state: PreviewErrorBoundaryState = {
    hasError: false,
    error: null,
    componentStack: null,
  };

  static getDerivedStateFromError(error: Error): Partial<PreviewErrorBoundaryState> {
    renderErrorActive = true;
    return {
      hasError: true,
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    renderErrorActive = true;
    this.setState({
      componentStack: errorInfo.componentStack || null,
    });

    if (typeof window !== 'undefined' && window.parent) {
      try {
        window.parent.postMessage(
          {
            type: 'preview:render-error',
            error: error?.message || String(error),
            url: this.props.url,
            componentStack: errorInfo?.componentStack || '',
          },
          '*',
        );
      } catch {
        /* ignore postMessage errors */
      }
    }

    this.props.onError?.(error, errorInfo);
  }

  override componentDidUpdate(prevProps: PreviewErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      (prevProps.url !== this.props.url || prevProps.revision !== this.props.revision)
    ) {
      this.resetError();
    }
  }

  override componentWillUnmount(): void {
    if (this.state.hasError) {
      renderErrorActive = false;
    }
  }

  resetError = (): void => {
    renderErrorActive = false;
    this.setState({
      hasError: false,
      error: null,
      componentStack: null,
    });
    this.props.onReset?.();
  };

  handleRetry = (): void => {
    this.resetError();
  };

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          data-preview-render-error=""
          style={{
            boxSizing: 'border-box',
            minHeight: '100vh',
            width: '100%',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            padding: '32px 24px',
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
          }}
        >
          <div
            style={{
              maxWidth: 720,
              width: '100%',
              backgroundColor: '#1e293b',
              border: '1px solid #ef4444',
              borderRadius: 8,
              padding: 24,
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    backgroundColor: '#ef4444',
                  }}
                />
                <h2
                  style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 600,
                    color: '#f87171',
                    letterSpacing: '-0.02em',
                  }}
                >
                  Preview Render Error
                </h2>
              </div>
              <button
                type="button"
                data-testid="preview-error-retry-btn"
                onClick={this.handleRetry}
                style={{
                  backgroundColor: '#334155',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
              >
                Retry
              </button>
            </div>

            <div
              style={{
                padding: '12px 16px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderLeft: '4px solid #ef4444',
                borderRadius: 4,
                marginBottom: 16,
                color: '#fca5a5',
                fontFamily: 'monospace',
                fontSize: 13,
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}
            >
              {this.state.error?.message || String(this.state.error || 'Unknown render error')}
            </div>

            {this.state.componentStack && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 8,
                  }}
                >
                  Component Stack
                </div>
                <pre
                  data-testid="preview-error-component-stack"
                  style={{
                    margin: 0,
                    padding: 12,
                    backgroundColor: '#0f172a',
                    borderRadius: 6,
                    color: '#cbd5e1',
                    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                    fontSize: 11,
                    lineHeight: 1.4,
                    overflowX: 'auto',
                    maxHeight: 280,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {this.state.componentStack}
                </pre>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PreviewErrorBoundary;
