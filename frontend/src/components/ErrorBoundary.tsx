import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-claw-bg">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4">💥</div>
            <h1 className="text-xl font-bold text-claw-text mb-2">出错了</h1>
            <p className="text-sm text-claw-muted mb-4">
              {this.state.error?.message ?? '发生了未知错误'}
            </p>
            <Button onClick={() => window.location.reload()}>刷新页面</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
