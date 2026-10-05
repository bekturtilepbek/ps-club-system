import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Leaves the broken screen (the "back" button). */
  onBack: () => void;
}

/** Catches a failed lazy chunk (offline, or a stale build after a deploy) instead of a white page. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="grid gap-3">
        <p>Не удалось загрузить экран. Обновите страницу.</p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Обновить</Button>
          <Button variant="outline" onClick={this.props.onBack}>
            ← Зал
          </Button>
        </div>
      </div>
    );
  }
}
