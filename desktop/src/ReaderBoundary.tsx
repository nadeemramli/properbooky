import { Component } from "react";
import type { ReactNode } from "react";

/** Keeps a failing reader inside its own tab: the rail, library and other
 * tabs stay usable instead of the whole window going blank. */
export default class ReaderBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="reader-error">
          <p>This reader stopped unexpectedly: {this.state.error}</p>
          <p>Close the tab and open the book again.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
