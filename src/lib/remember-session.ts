import { authClient } from "@/lib/auth/client";

/** Keep the live-preview bearer so scoreboardet og serverkald kan se sessionen. */
export async function rememberSession(token: string | null | undefined) {
  if (!token || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem("grok-auth.bearer-token", token);
  } catch {
    /* privat tilstand */
  }
  try {
    await authClient.getSession();
  } catch {
    /* sessionen hentes igen af auth-provideren */
  }
}
