// Who is at the keyboard. Two segregated roles for the demo; a real deployment binds these to SSO groups.
import { cookies } from "next/headers";
import { ROLES, type Role } from "@/db/types";

export async function currentRole(): Promise<Role> {
  const c = (await cookies()).get("signet_role")?.value;
  return c === "finance" ? "finance" : "supervisor";
}
export async function currentHuman() {
  const role = await currentRole();
  return { role, ...ROLES[role] };
}
export function requireRole(role: Role, want: Role, what: string) {
  if (role !== want) throw new Error(`${what} requires the ${ROLES[want].title}. Switch role in the header.`);
}
