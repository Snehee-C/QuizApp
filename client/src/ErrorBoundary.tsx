import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Without this, any uncaught render error unmounts the whole app and leaves
// a blank white screen with no way to tell what happened (especially bad on
// a phone with no visible dev console).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <p className="text-xl font-bold text-red-600 mb-2">Something went wrong</p>
            <p className="text-gray-500 text-sm mb-4">{this.state.error.message}</p>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.href = "/";
              }}
              className="bg-brand text-white px-4 py-2 rounded-lg font-medium"
            >
              Go home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
