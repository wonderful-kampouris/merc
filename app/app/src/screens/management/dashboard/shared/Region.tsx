import { Button, Card, EmptyState, Icon, Notice, Skeleton } from "@wonderful/ui-base";
import { TrayIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { AsyncState } from "./useAsync";
import { errorDetail, errorKey, type ErrorKey } from "./errors";

type T = (key: ErrorKey | "retry") => string;

/** Loading skeleton, error notice with retry, empty state, or the content: one place for every region's states. */
export function Region<D>(props: {
  state: AsyncState<D> & { reload: () => void };
  t: T;
  isEmpty?: (d: D) => boolean;
  emptyTitle?: string;
  emptyBody?: string;
  rows?: number;
  children: (d: D) => ReactNode;
}): ReactNode {
  const { state, t } = props;
  if (state.status === "error" && state.data === undefined) {
    const key = errorKey(state.error);
    return (
      <Card>
        <Card.Content>
          <div role="alert" data-state="error">
            <Notice variant="warning" title={t(key)} description={errorDetail(state.error)} />
            <Button size="small" variant="secondary" onClick={state.reload}>
              {t("retry")}
            </Button>
          </div>
        </Card.Content>
      </Card>
    );
  }
  if (state.data === undefined) {
    return (
      <Card>
        <Card.Content>
          <div data-state="loading" aria-busy="true">
            <Skeleton.Text rows={props.rows ?? 4} />
          </div>
        </Card.Content>
      </Card>
    );
  }
  const data = state.data;
  if (props.isEmpty?.(data)) {
    return (
      <div data-state="empty">
        <EmptyState icon={<Icon icon={TrayIcon} />} title={props.emptyTitle} description={props.emptyBody} />
      </div>
    );
  }
  return <>{props.children(data)}</>;
}
