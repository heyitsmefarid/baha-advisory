import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { Field } from "../../components/ui";

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      // Don't reveal whether an account exists for this address.
      if (code === "auth/invalid-email") setError("Enter a valid email address.");
      else setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-card__logo" src="/logo/bahadvisory_logo.png" alt="Bahadvisory" />
        {sent ? (
          <>
            <h3>Check your email</h3>
            <p className="muted">
              If an account exists for <strong>{email}</strong>, we've sent a link to set a new password.
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="login-card__subtitle">Enter the email you signed up with and we'll send you a reset link.</p>
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
        <div className="login-card__links">
          <Link to="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
