import { Button, Card, Layout, Text } from "@wonderful/ui-base";
import { Suspense, type ReactNode } from "react";
import AppErrorBoundary from "./AppErrorBoundary";

interface AppBoundaryProps {
	children: ReactNode;
	/** Shown while a suspending child (a data fetch) resolves. */
	pending?: ReactNode;
}

/**
 * Wrap any region that loads data or can fail on its own. A thrown error shows
 * a contained message with a retry instead of blanking the app, and a
 * suspending child shows `pending` while it resolves. Nest one per independent
 * region so one failure never takes the rest of the page down with it.
 */
export default function AppBoundary({ children, pending }: AppBoundaryProps) {
	return (
		<AppErrorBoundary
			fallback={(error, reset) => (
				<Card>
					<Card.Content>
						<Layout.Stack gap="sm">
							<Text variant="body">Something went wrong rendering this section.</Text>
							<Text as="span" variant="body-sm" color="secondary" code>
								{error.message}
							</Text>
							{/* The design system's Button, not a bare <button>: the
							    embedded Tailwind preflight strips a raw button down to
							    unstyled text, which would leave the only way out of this
							    fallback looking like a sentence. */}
							<Button onClick={reset}>Try again</Button>
						</Layout.Stack>
					</Card.Content>
				</Card>
			)}
		>
			<Suspense
				fallback={
					pending ?? (
						<Text variant="body-sm" color="secondary">
							Loading…
						</Text>
					)
				}
			>
				{children}
			</Suspense>
		</AppErrorBoundary>
	);
}
