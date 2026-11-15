import { Alert, Button, Card, EmptyState, Icon, Layout, Skeleton, Text } from "@wonderful/ui-base";
import { TrayIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { errorText, type LoadState } from "./kit";

/** Loading skeleton, error card with retry, or the children for ready data. */
export function LoadView<T>(p: {
  state: LoadState<T>;
  retryLabel: string;
  errorTitle: string;
  onRetry: () => void;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (p.state.status === "loading") {
    return (
      <Card>
        <Card.Content>
          <Skeleton.Text rows={p.rows ?? 4} />
        </Card.Content>
      </Card>
    );
  }
  if (p.state.status === "error") {
    return (
      <Alert
        variant="error"
        title={p.errorTitle}
        description={errorText(p.state.error)}
        action={
          <Button size="small" variant="secondary" onClick={p.onRetry}>
            {p.retryLabel}
          </Button>
        }
      />
    );
  }
  return <>{p.children(p.state.data)}</>;
}

export function Empty(p: { title: string; description?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <Card>
      <Card.Content>
        <EmptyState icon={<Icon icon={TrayIcon} />} title={p.title} description={p.description} actions={p.action ? [p.action] : []} />
      </Card.Content>
    </Card>
  );
}

/**
 * A Card.List row with rich content under the title. Card.Meta renders its description inside a <p>, so
 * badges/inputs (block elements) there are invalid DOM; this row keeps them in a Layout instead.
 */
export function RichRow(p: { avatar?: ReactNode; title: ReactNode; actions?: ReactNode; description?: ReactNode }) {
  return (
    <Card.List.Item>
      <Layout.Row gap="sm" align="start">
        {p.avatar ?? null}
        <Layout.Stack gap="xs" className="flex-1 min-w-0">
          <Layout.Row split>
            {typeof p.title === "string" ? <Text variant="md" weight="medium">{p.title}</Text> : p.title}
            {p.actions ?? null}
          </Layout.Row>
          {p.description ?? null}
        </Layout.Stack>
      </Layout.Row>
    </Card.List.Item>
  );
}
