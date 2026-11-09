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
        <div className="min-h-[100dvh] grid place-items-center px-6 text-center bg-canvas text-ink">
          <div className="max-w-sm flex flex-col gap-3 items-center">
            <p className="font-display text-title2 font-bold">Something broke</p>
            <p className="text-ink-subtle text-subhead">{this.state.error.message}</p>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.hash = "#/";
              }}
              className="mt-2 h-11 px-5 rounded-md bg-accent text-accent-ink font-semibold"
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
