"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// Finishes a link from a Supabase email (confirm your address, reset your
// password, accept an invitation). Supabase puts the details after "#" in the
// address, which only the browser can read, so this component reads them and
// hands them to a server action: straight away for a confirmation, or with a
// new password for a reset or an invitation.

interface LinkDetails {
  accessToken: string;
  tokenHash: string;
  type: string;
  error: string;
}

function readLink(): LinkDetails {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const pick = (k: string) => hash.get(k) ?? query.get(k) ?? "";
  return {
    accessToken: pick("access_token"),
    tokenHash: pick("token_hash"),
    type: pick("type"),
    error: pick("error_description") || pick("error"),
  };
}

// Read once per page load: the address is cleaned straight after.
let cachedLink: string | null = null;
function linkSnapshot(): string {
  cachedLink ??= JSON.stringify(readLink());
  return cachedLink;
}
const noSubscription = () => () => {};

export interface EmailLinkClasses {
  form: string;
  field: string;
  label: string;
  input: string;
  button: string;
  error: string;
  muted: string;
}

export function EmailLink({
  action,
  classes,
  minPassword,
}: {
  action: (form: FormData) => Promise<void>;
  classes: EmailLinkClasses;
  minPassword: number;
}) {
  const raw = useSyncExternalStore(noSubscription, linkSnapshot, () => "");
  const link = raw ? (JSON.parse(raw) as LinkDetails) : null;
  const autoSubmit = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Keep the token out of the address bar and history.
    if (window.location.hash || window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const needsPassword = link?.type === "recovery" || link?.type === "invite";
  useEffect(() => {
    if (link && !link.error && (link.accessToken || link.tokenHash) && !needsPassword) autoSubmit.current?.requestSubmit();
  }, [link, needsPassword]);

  if (!link) return <p className={classes.muted}>Checking your link…</p>;
  if (link.error || (!link.accessToken && !link.tokenHash)) {
    return (
      <p className={classes.error} role="alert">
        {link.error ? `${link.error}.` : "This link is not complete."} Please ask for a new one.
      </p>
    );
  }

  const hidden = (
    <>
      <input type="hidden" name="access_token" value={link.accessToken} />
      <input type="hidden" name="token_hash" value={link.tokenHash} />
      <input type="hidden" name="type" value={link.type} />
    </>
  );

  if (!needsPassword) {
    return (
      <form ref={autoSubmit} action={action} className={classes.form}>
        {hidden}
        <p className={classes.muted}>Confirming your email address…</p>
        <button type="submit" className={classes.button}>
          Continue
        </button>
      </form>
    );
  }

  return (
    <form action={action} className={classes.form}>
      {hidden}
      <p className={classes.muted}>{link.type === "invite" ? "Welcome. Choose a password for your account." : "Choose a new password."}</p>
      <label className={classes.field}>
        <span className={classes.label}>New password</span>
        <input className={classes.input} name="password" type="password" required minLength={minPassword} maxLength={72} autoComplete="new-password" />
      </label>
      <button type="submit" className={classes.button}>
        Save password and sign in
      </button>
    </form>
  );
}
