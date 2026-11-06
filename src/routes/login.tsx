import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { SiteShell } from "@/components/site-shell";
import { AuthCard, Field, inputClass, Submit, SwitchLink } from "@/components/auth-card";
import { authClient } from "@/lib/auth/client";
import { rememberSession } from "@/lib/remember-session";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => {
    const next = typeof search.next === "string" ? search.next : "";
    const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/konto";
    return { next: safe };
  },
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    const result = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
    });
    if (result.error) {
      setPending(false);
      const message = result.error.message ?? "";
      setError(
        result.error.status === 503 || /database_url|databasen/i.test(message)
          ? "Login virker ikke endnu. Databasen er ikke koblet på den live side."
          : "Mail eller adgangskode passer ikke.",
      );
      return;
    }
    await rememberSession(result.data?.token);
    if (next.startsWith("/board")) {
      window.location.href = next;
      return;
    }
    await navigate({ to: "/konto" });
  }

  return (
    <SiteShell>
      <AuthCard
        title="Log ind"
        lede="Brug den mail og adgangskode, du har fået — eller din egen konto."
        footer={
          <>
            Ingen konto endnu? <SwitchLink to="/opret">Opret bruger</SwitchLink>
          </>
        }
      >
        <form className="grid gap-4" onSubmit={onSubmit}>
          <Field label="E-mail">
            <input className={inputClass} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Adgangskode">
            <input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Submit pending={pending}>Log ind</Submit>
        </form>
      </AuthCard>
    </SiteShell>
  );
}
