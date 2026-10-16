import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { Field } from "../../components/ui";

/**
 * Citizen self-registration. Accounts start as citizens — LGU and
 * business roles are granted by an organization admin or the platform
 * after verification, never chosen here.
 */
export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      await register(name.trim(), email.trim(), password);
      navigate("/me?welcome=1", { replace: true });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(
        code === "auth/email-already-in-use"
          ? "An account with this email already exists. Try signing in."
          : code === "auth/invalid-email"
          ? "Enter a valid email address."
          : code === "auth/operation-not-allowed"
          ? "Email/password sign-up is not enabled for this Firebase project."
          : "We couldn't create your account. Please try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-card__logo" src="/logo/bahadvisory_logo.png" alt="Bahadvisory" />
        <p className="login-card__subtitle">
          Free for every resident. Get flood alerts for your home, school or workplace and help your community by reporting
          flooding.
        </p>
        <form onSubmit={submit}>
          <Field label="Full name">
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" maxLength={80} />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </Field>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Create free account"}
          </button>
        </form>
        <p className="tiny" style={{ marginTop: "1em" }}>
          Representing an LGU, a business or an enterprise? Create your account first, then set up your organization from{" "}
          <Link to="/pricing">Pricing</Link>.
        </p>
        <div className="login-card__links">
          <Link to="/login">Already have an account? Sign in</Link>
        </div>
      </div>
    </div>
  );
}
