import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function AuthCard({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-lg gap-6 px-4 py-12">
      <div className="text-center">
        <img src="/branding/logo-nav.png" alt="" className="mx-auto mb-4 h-20 w-auto object-contain" />
        <h1 className="font-display text-5xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">{lede}</p>
      </div>
      <div className="rounded-card border border-line bg-surface p-5">{children}</div>
      <div className="text-center text-sm text-muted">{footer}</div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-fg outline-none focus-visible:border-primary";

export function Submit({ children, pending }: { children: ReactNode; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 min-h-12 w-full rounded-xl bg-primary font-display text-2xl text-primary-fg disabled:opacity-60"
    >
      {pending ? "Vent…" : children}
    </button>
  );
}

export function SwitchLink({ to, children }: { to: "/login" | "/opret"; children: ReactNode }) {
  if (to === "/login") {
    return (
      <Link to="/login" search={{ next: "/konto" }} className="font-semibold text-primary">
        {children}
      </Link>
    );
  }
  return (
    <Link to="/opret" className="font-semibold text-primary">
      {children}
    </Link>
  );
}
