import { Component, type ReactNode } from "react";
import { Button } from "./components/ui/Button";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** The room this tab was in when it broke, if it was in one. */
function joinRouteFromHash(): string | null {
  const m = /^#(\/join\/\d{6})(?:[/?#]|$)/.exec(window.location.hash);
  return m ? m[1] : null;
}

// Without this, any uncaught render error unmounts the whole app and leaves
// a blank white screen with no way to tell what happened (especially bad on
// a phone with no visible dev console).
//
// What it says is deliberately plain. A player who hits this is standing in a
// room with a question on the wall; `error.message` is for the console, where
// it still goes, and the one door that matters is the one back into the game
// — their seat is still valid, and "Go home" used to be the only exit, which
// abandoned it (UX-PLAN 3.7).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (this.state.error) {
      const back = joinRouteFromHash();
      return (
        <div className="min-h-[100dvh] grid place-items-center px-6 text-center bg-canvas text-ink">
          <div className="max-w-sm flex flex-col gap-3 items-center">
            <p className="font-display text-title2 font-bold">Something went wrong</p>
            <p className="text-ink-subtle text-subhead">
              {back
                ? "Your seat in the game is still yours — head back in and you'll pick up where the room is."
                : "Nothing you did caused this. Head home and try again."}
            </p>
            <div className="mt-2 flex flex-col gap-2 w-full items-stretch">
              {back && (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    // The hash is already the room; clearing the error is what
                    // remounts the route. Set it anyway so a boundary that
                    // caught on a sub-route still lands on the room itself.
                    window.location.hash = `#${back}`;
                    this.setState({ error: null });
                  }}
                >
                  Back to the game
                </Button>
              )}
              <Button
                variant={back ? "secondary" : "primary"}
                size="lg"
                onClick={() => {
                  window.location.hash = "#/";
                  this.setState({ error: null });
                }}
              >
                Go home
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
