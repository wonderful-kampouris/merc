/** Test-only: the real typed client in mock mode, limited to one screen's app.json functions, recording calls. */
import { createClient, type MercClient } from "../../../../lib/client";
import { findScreen } from "../../../../lib/routes";

export function createScreenTestClient(route: string): { client: MercClient; calls: string[] } {
  const screen = findScreen(route);
  if (!screen) throw new Error(`no app.json screen ${route}`);
  const calls: string[] = [];
  const base = createClient({ mock: true, invoker: { invokeFunction: () => Promise.reject(new Error("live call in a mock test")) } }).forScreen(screen.functions);
  const client: MercClient = {
    mock: true,
    forScreen: base.forScreen,
    call: ((slug: string, body?: unknown) => {
      calls.push(slug);
      return base.call(slug as never, body as never);
    }) as MercClient["call"],
  };
  return { client, calls };
}
