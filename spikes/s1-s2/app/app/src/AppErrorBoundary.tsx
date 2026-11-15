import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
	/** Rendered in place of the children once a descendant throws. */
	fallback: (error: Error, reset: () => void) => ReactNode;
	children: ReactNode;
}

interface AppErrorBoundaryState {
	error: Error | null;
}

/**
 * Catches render errors from its subtree and hands them to `fallback` instead
 * of letting them blank the whole app. React error boundaries must be class
 * components — this is the one class in the template; everything else is a
 * function. Prefer `AppBoundary`, which pairs this with a `<Suspense>`.
 */
export default class AppErrorBoundary extends Component<
	AppErrorBoundaryProps,
	AppErrorBoundaryState
> {
	state: AppErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		// Surfaced in the local runner and the platform preview. Point this at
		// your own reporter if you have one.
		console.error("App render error:", error, info.componentStack);
	}

	private readonly reset = (): void => this.setState({ error: null });

	render(): ReactNode {
		if (this.state.error) {
			return this.props.fallback(this.state.error, this.reset);
		}
		return this.props.children;
	}
}
