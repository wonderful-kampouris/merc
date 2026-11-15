import type { FunctionRequestMap } from "../../../contracts";
import { seedRows } from "../../../contracts";
import { optStr, str, strArr, type Obj } from "../settings/kit";

export type RoleCode = "rep" | "manager" | "admin";
export const ROLES: readonly RoleCode[] = ["rep", "manager", "admin"];
const asRole = (s: string): RoleCode | null => (ROLES.includes(s as RoleCode) ? (s as RoleCode) : null);

export interface User {
  id: string;
  full_name: string;
  email: string;
  role_code: RoleCode;
  manager_id: string | null;
  phone: string | null;
  status: "active" | "left";
  /** null when users-list does not return memberships: an edit would then clear them, so it is blocked. */
  territory_ids: string[] | null;
}

export function parseUsers(items: Obj[]): User[] {
  return items
    .filter((o) => str(o, "id") && str(o, "full_name") && asRole(str(o, "role_code")))
    .map((o) => ({
      id: str(o, "id"),
      full_name: str(o, "full_name"),
      email: str(o, "email"),
      role_code: asRole(str(o, "role_code"))!,
      manager_id: optStr(o, "manager_id"),
      phone: optStr(o, "phone"),
      status: (str(o, "status") === "left" ? "left" : "active") as User["status"],
      territory_ids: strArr(o, "territory_ids"),
    }))
    .sort((a, b) => ROLES.indexOf(b.role_code) - ROLES.indexOf(a.role_code) || a.full_name.localeCompare(b.full_name));
}

/** Mock mode: add territory memberships from the seed (territory_rep) so the demo rows are editable. */
export function seedTerritories(users: User[]): User[] {
  const tr = seedRows("territory_rep");
  return users.map((u) => (u.territory_ids ? u : { ...u, territory_ids: tr.filter((r) => r.user_id === u.id).map((r) => String(r.territory_id)) }));
}

export const nameOf = (users: User[], id: string | null): string | null => (id ? users.find((u) => u.id === id)?.full_name ?? null : null);

/** People a user can report to: active managers and admins other than the user. */
export const managerOptions = (users: User[], self: string | null): User[] =>
  users.filter((u) => u.id !== self && u.status === "active" && (u.role_code === "manager" || u.role_code === "admin"));

export interface UserForm {
  user_id: string | null;
  email: string;
  full_name: string;
  role_code: RoleCode;
  manager_id: string | null;
  phone: string;
  territory_ids: string[];
  status: "active" | "left";
}

export const emptyUserForm = (): UserForm => ({ user_id: null, email: "", full_name: "", role_code: "rep", manager_id: null, phone: "", territory_ids: [], status: "active" });
export function formFromUser(u: User): UserForm | null {
  if (!u.territory_ids) return null;
  return { user_id: u.id, email: u.email, full_name: u.full_name, role_code: u.role_code, manager_id: u.manager_id, phone: u.phone ?? "", territory_ids: u.territory_ids, status: u.status };
}

export type UserProblem = "full_name" | "email" | "phone" | "manager";
export function validateUser(f: UserForm): UserProblem[] {
  const out: UserProblem[] = [];
  if (!f.full_name.trim()) out.push("full_name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) out.push("email");
  if (f.phone.trim() && !/^\+?[0-9 ]{8,16}$/.test(f.phone.trim())) out.push("phone");
  if (f.role_code === "rep" && !f.manager_id) out.push("manager");
  return out;
}

export function toUpsert(f: UserForm): FunctionRequestMap["user-upsert"] {
  return {
    user_id: f.user_id,
    email: f.email.trim().toLowerCase(),
    full_name: f.full_name.trim(),
    role_code: f.role_code,
    manager_id: f.manager_id,
    phone: f.phone.trim() ? f.phone.replace(/\s+/g, "") : null,
    territory_ids: f.territory_ids,
    status: f.status,
  };
}
