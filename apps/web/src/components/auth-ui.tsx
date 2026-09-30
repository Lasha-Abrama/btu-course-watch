import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About BTU Course Watch">
        <Link href="/" className="brand">
          <span className="brand-mark">
            B<span>.</span>
          </span>
          <span>BTU Course Watch</span>
        </Link>
        <div className="story-center">
          <span className="story-tag">A clearer path through registration</span>
          <h2>
            Your next course starts with a little more certainty<span>.</span>
          </h2>
          <p>
            One place for your BTU Course Watch account. The browser extension
            can check watched courses while Chrome is running.
          </p>
          <div className="orbit" aria-hidden="true">
            <span>BTU</span>
            <i />
            <i />
            <i />
          </div>
        </div>
        <p className="story-foot">
          Built for BTU students. Independent from BTU Classroom.
        </p>
      </section>
      <section className="auth-content">
        <div className="auth-card">
          <div className="mobile-brand">
            <Link href="/">
              BTU Course Watch<span>.</span>
            </Link>
          </div>
          <p className="form-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="form-description">{description}</p>
          {children}
          {footer && <div className="form-footer">{footer}</div>}
        </div>
      </section>
    </main>
  );
}

export function FormField({
  label,
  id,
  type = "text",
  value,
  onChange,
  autoComplete,
  required = true,
  hint,
  minLength,
  maxLength,
}: {
  label: string;
  id: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Notice({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: ReactNode;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`notice notice-${kind}`}
    >
      {children}
    </div>
  );
}

export function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button className="primary-button" type="submit" disabled={busy}>
      {busy ? "Please wait…" : children}
    </button>
  );
}
