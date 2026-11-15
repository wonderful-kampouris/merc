import { createClient, type MercClient } from "../../../../lib/client";
import { SCREENS } from "../../../../lib/routes";

export type Handler = (params: Record<string, unknown>) => unknown;

/**
 * A real MercClient (contract validation, unwrap, screen allow-list) over a fake platform invoker.
 * `handlers[slug]` returns the bare result, or throws to simulate a failure. Calls are recorded.
 */
export function createFakeClient(screenKey: string, handlers: Record<string, Handler>) {
  const screen = SCREENS.find((s) => s.shell === "rep" && s.key === screenKey)!;
  const calls: Array<{ slug: string; params: Record<string, unknown> }> = [];
  const client: MercClient = createClient({
    mock: false,
    invoker: {
      async invokeFunction<T>(qualified: string, options?: { params?: Record<string, unknown> }): Promise<T> {
        const slug = qualified.replace(/^merc\//, "");
        const params = options?.params ?? {};
        calls.push({ slug, params });
        const h = handlers[slug];
        if (!h) throw new Error(`no fake handler for ${slug}`);
        return { result: await h(params), logs: [] } as T;
      },
    },
  }).forScreen(screen.functions);
  return { client, calls, screen };
}
