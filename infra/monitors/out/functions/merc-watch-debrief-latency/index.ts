// merc-watch wrapper. Logic: Merc monorepo infra/monitors/src/watches.ts, bundled into ./handler.gen.js. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
