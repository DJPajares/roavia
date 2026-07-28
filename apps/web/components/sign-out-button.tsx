import { signOut } from "../app/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button className="roavia-button roavia-button--quiet" type="submit">
        Sign out
      </button>
    </form>
  );
}
