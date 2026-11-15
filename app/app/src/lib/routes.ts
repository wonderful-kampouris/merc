import appContract from "../contracts/app.json";

export type Role = "rep" | "manager" | "admin";
export type Shell = "rep" | "management";

/** One screen of contracts/app/app.json. */
export interface Screen {
  shell: Shell;
  key: string;
  route: string;
  functions: readonly string[];
  events: readonly string[];
  offline: boolean;
  /** Rep screens are mobile-first; management screens only when the contract says so. */
  mobile: boolean;
  voiceWidget?: string;
}

interface RawScreen {
  route: string;
  functions: string[];
  events?: string[];
  offline?: boolean;
  mobile?: boolean;
  voice_widget?: string;
}

const raw = (appContract as unknown as { screens: Record<Shell, Record<string, RawScreen>> }).screens;

export const SCREENS: readonly Screen[] = (Object.keys(raw) as Shell[]).flatMap((shell) =>
  Object.entries(raw[shell]).map(([key, s]) => ({
    shell,
    key,
    route: s.route,
    functions: s.functions,
    events: s.events ?? [],
    offline: !!s.offline,
    mobile: shell === "rep" || !!s.mobile,
    voiceWidget: s.voice_widget,
  })),
);

export const DEFAULT_ROLE = (appContract as { default_role: string }).default_role as Role;

/** Which shells a role may open, first one is home. */
export const SHELLS_FOR_ROLE: Record<Role, readonly Shell[]> = {
  rep: ["rep"],
  manager: ["management", "rep"],
  admin: ["management", "rep"],
};

const ROLE_PRIORITY: readonly Role[] = ["admin", "manager", "rep"];

/** Highest app role the session holds (context.appRole / appRoles); falls back to the contract's default_role. */
export function resolveRole(roles: readonly (string | undefined | null)[]): Role {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? DEFAULT_ROLE;
}

export const screensFor = (shell: Shell): Screen[] => SCREENS.filter((s) => s.shell === shell);
export const findScreen = (route: string | null | undefined): Screen | undefined => SCREENS.find((s) => s.route === route);
export const canAccess = (role: Role, route: string): boolean => {
  const s = findScreen(route);
  return !!s && SHELLS_FOR_ROLE[role].includes(s.shell);
};
export const shellHome = (shell: Shell): Screen => screensFor(shell)[0]!;
export const homeScreen = (role: Role): Screen => shellHome(SHELLS_FOR_ROLE[role][0]!);

/** The screen to render for a requested route: the route itself when the role may open it, otherwise the role's home. */
export function resolveRoute(role: Role, requested?: string | null): Screen {
  return requested && canAccess(role, requested) ? findScreen(requested)! : homeScreen(role);
}
