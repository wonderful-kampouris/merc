import { Card, Layout, Skeleton } from "@wonderful/ui-base";

/** Placeholder cards while a list loads. */
export default function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <Layout.Stack gap="sm">
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i}>
          <Card.Content>
            <Skeleton.Text rows={3} />
          </Card.Content>
        </Card>
      ))}
    </Layout.Stack>
  );
}
