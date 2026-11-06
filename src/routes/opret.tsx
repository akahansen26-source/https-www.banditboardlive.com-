import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { SiteShell } from "@/components/site-shell";
import { AuthCard, Field, inputClass, Submit, SwitchLink } from "@/components/auth-card";
import { authClient } from "@/lib/auth/client";
import { rememberSession } from "@/lib/remember-session";
import { saveMyProfile } from "@/lib/venues";

export const Route = createFileRoute("/opret")({ component: SignupPage });

function signupError(error: { message?: string; status?: number; code?: string } | null): string {
  const message = error?.message?.trim() ?? "";
  const code = error?.code ?? "";
  if (code === "USER_ALREADY_EXISTS" || /already exists|already registered/i.test(message)) {
    return "Den e-mail er allerede oprettet. Log ind i stedet.";
  }
  if (/invalid origin/i.test(message)) {
    return "Siden afviste oprettelsen. Åbn banditboardlive.com og prøv igen.";
  }
  if (error?.status === 503 || /database_url|databasen er ikke/i.test(message)) {
    return "Kontoen kan ikke gemmes endnu. Databasen er ikke koblet på den live side.";
  }
  if (message && !/internal server error|failed to fetch/i.test(message)) return message;
  return "Kontoen kunne ikke oprettes. Prøv igen om et øjeblik.";
}

function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    venueName: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    postalCode: "",
    city: "",
    password: "",
    again: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const passwordOk = form.password.length >= 8;
  const passwordsMatch = form.password === form.again;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.venueName.trim()) {
      setError("Skriv navnet på klubben, pubben eller stedet.");
      return;
    }
    if (!passwordOk) {
      setError("Adgangskoden skal være mindst 8 tegn.");
      return;
    }
    if (!passwordsMatch) {
      setError("Adgangskoderne er ikke ens.");
      return;
    }
    setPending(true);
    try {
      const result = await authClient.signUp.email({
        name: form.venueName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        callbackURL: "/konto",
      });
      if (result.error) {
        setError(signupError(result.error));
        return;
      }
      await rememberSession(result.data?.token);
      try {
        await saveMyProfile({
          data: {
            venueName: form.venueName.trim(),
            contactName: form.contactName.trim(),
            email: form.email.trim().toLowerCase(),
            phone: form.phone.trim(),
            address: form.address.trim(),
            postalCode: form.postalCode.trim(),
            city: form.city.trim(),
            notes: "",
            accessCode: "",
          },
        });
      } catch {
        /* profilen oprettes også når kontoen åbnes */
      }
      await navigate({ to: "/konto" });
    } catch {
      setError("Kontoen kunne ikke oprettes. Tjek forbindelsen og prøv igen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <SiteShell>
      <AuthCard
        title="Opret bruger"
        lede="Kontoen starter som gæst og afventer godkendelse. Indtil da kan du se den offentlige live-side."
        footer={
          <>
            Har du allerede en konto? <SwitchLink to="/login">Log ind</SwitchLink>
          </>
        }
      >
        <form className="grid gap-4" onSubmit={onSubmit}>
          <Field label="Klub, pub eller sted">
            <input
              className={inputClass}
              required
              value={form.venueName}
              onChange={(e) => set("venueName", e.target.value)}
              placeholder="Sanderum Pubben"
              autoComplete="organization"
            />
          </Field>
          <Field label="Kontaktperson">
            <input
              className={inputClass}
              value={form.contactName}
              onChange={(e) => set("contactName", e.target.value)}
              autoComplete="name"
              placeholder="Valgfrit"
            />
          </Field>
          <Field label="E-mail">
            <input
              className={inputClass}
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="dig@mail.dk"
            />
          </Field>
          <Field label="Telefon">
            <input
              className={inputClass}
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="Valgfrit"
            />
          </Field>
          <Field label="Adresse">
            <input
              className={inputClass}
              autoComplete="street-address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Valgfrit"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="Postnr.">
              <input
                className={inputClass}
                autoComplete="postal-code"
                inputMode="numeric"
                value={form.postalCode}
                onChange={(e) => set("postalCode", e.target.value)}
              />
            </Field>
            <Field label="By">
              <input
                className={inputClass}
                autoComplete="address-level2"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Adgangskode">
            <input
              className={inputClass}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </Field>
          <Field label="Gentag adgangskode">
            <input
              className={inputClass}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={form.again}
              onChange={(e) => set("again", e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
            Vis adgangskode
          </label>
          <p className={`text-sm ${passwordOk ? "text-ok" : "text-muted"}`}>
            {passwordOk ? "Adgangskoden er lang nok." : "Mindst 8 tegn."}
            {form.again && !passwordsMatch ? " Koderne er ikke ens." : ""}
            {form.again && passwordsMatch && passwordOk ? " Koderne matcher." : ""}
          </p>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Submit pending={pending}>Opret bruger</Submit>
        </form>
      </AuthCard>
    </SiteShell>
  );
}
