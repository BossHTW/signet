import { ROLES, type Role } from "@/db/types";
import { switchRoleAction } from "@/app/actions";

export function RoleSwitch({ role }: { role: Role }) {
  const other: Role = role === "finance" ? "supervisor" : "finance";
  return (
    <form action={switchRoleAction} title={`Signed in as ${ROLES[role].title} — may ${ROLES[role].may}. Click to switch (demo).`}>
      <input type="hidden" name="role" value={other} />
      <button className="btn" type="submit">
        {ROLES[role].title.replace(/ \(.*\)/, "")}
        <span className="faint" aria-hidden>⇄</span>
      </button>
    </form>
  );
}
