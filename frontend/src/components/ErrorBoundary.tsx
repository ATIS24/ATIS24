import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort safety net around the whole app. React unmounts the entire
 * tree on an uncaught render error, which — with nothing catching it —
 * leaves <div id="root"></div> empty and the page looks completely blank.
 * This boundary catches that instead and shows a visible, recoverable
 * message. It is not a substitute for fixing the underlying error (which
 * is still logged to the console), just a guarantee the user never sees
 * a silent white screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled error in app render tree:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-shell app-shell--centered">
          <div className="login-screen__panel">
            <p className="app-forbidden-text">
              Something went wrong loading ATIS Radio. Reloading usually fixes this.
            </p>
            <button
              type="button"
              className="radio-panel__logout"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
