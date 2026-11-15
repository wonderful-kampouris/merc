import "./style.css";
import { useWonderful } from "@wonderful/app-sdk";
import { useMemo, useRef, useState } from "react";
import { createClient } from "./lib/client";
import { I18nProvider, initialLang, storeLang, type Lang } from "./lib/i18n";
import type { SocketLike } from "./lib/live";
import { readMockFlag, storeMockFlag } from "./lib/mockFlag";
import { resolveRole, resolveRoute, shellHome, SHELLS_FOR_ROLE, type Role, type Shell } from "./lib/routes";
import { readQuery, readStored, writeStored } from "./lib/storage";
import AppBoundary from "./AppBoundary";
import { screenRegistry } from "./screens/registry";
import MgmtShell from "./shell/MgmtShell";
import RepShell from "./shell/RepShell";
import TopBar from "./shell/TopBar";

const ROUTE_KEY = "merc.route";
const ROLE_KEY = "merc.role";
const isRole = (r: string | null): r is Role => r === "rep" || r === "manager" || r === "admin";

/**
 * Merc app root: one Wonderful App holding the rep (mobile-first) and management shells.
 * Routing is in-memory (the app is mounted inside the platform page, which owns the URL);
 * routes and their function lists come from contracts/app/app.json.
 */
export default function App() {
  const { context, api } = useWonderful();
  const apiRef = useRef(api);
  apiRef.current = api;

  const [lang, setLang] = useState<Lang>(initialLang);
  const [mock, setMock] = useState<boolean>(readMockFlag);
  const [roleOverride, setRoleOverride] = useState<Role | null>(() => {
    const q = readQuery("role");
    return isRole(q) ? q : (() => { const s = readStored(ROLE_KEY); return isRole(s) ? s : null; })();
  });
  const sessionRole = resolveRole([context.appRole, ...(context.appRoles ?? [])]);
  // The role override is a demo aid for mock mode only; live sessions always use the app session's role.
  const role: Role = mock && roleOverride ? roleOverride : sessionRole;
  const [route, setRoute] = useState<string | null>(() => readQuery("route") ?? readStored(ROUTE_KEY, "session"));
  const screen = resolveRoute(role, route);

  const client = useMemo(
    () => createClient({ mock, invoker: { invokeFunction: (slug, options) => apiRef.current.invokeFunction(slug, options) } }),
    [mock],
  );
  const screenClient = useMemo(() => client.forScreen(screen.functions), [client, screen]);
  const liveClient = screen.shell === "rep" ? "rep" : "mgmt";
  const openLiveSocket = mock
    ? undefined
    : () => apiRef.current.openFunctionSocket(`merc/merc-live?client=${liveClient}`) as unknown as SocketLike;

  const navigate = (r: string) => {
    setRoute(r);
    writeStored(ROUTE_KEY, r, "session");
  };
  // Route -> lazy screen module from src/screens/<shell>/<screen>/index.tsx, or the placeholder (screens/registry.ts).
  const ScreenComponent = screenRegistry.component(screen);
  const body = (
    <AppBoundary key={screen.route}>
      <ScreenComponent screen={screen} client={screenClient} openLiveSocket={openLiveSocket} navigate={navigate} lang={lang} />
    </AppBoundary>
  );

  return (
    <I18nProvider lang={lang}>
      <div className="merc-root" lang={lang} data-shell={screen.shell}>
        <TopBar
          lang={lang}
          onLang={(l) => {
            setLang(l);
            storeLang(l);
          }}
          shells={SHELLS_FOR_ROLE[role]}
          shell={screen.shell}
          onShell={(s: Shell) => navigate(shellHome(s).route)}
          mock={mock}
          onMock={(on) => {
            setMock(on);
            storeMockFlag(on);
          }}
          role={role}
          onRole={(r) => {
            setRoleOverride(r);
            writeStored(ROLE_KEY, r);
          }}
          userName={context.userName}
        />
        {screen.shell === "rep" ? (
          <RepShell screen={screen} navigate={navigate}>
            {body}
          </RepShell>
        ) : (
          <MgmtShell screen={screen} navigate={navigate}>
            {body}
          </MgmtShell>
        )}
      </div>
    </I18nProvider>
  );
}
