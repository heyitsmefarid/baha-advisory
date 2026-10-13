import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getClaims } from "../services/authService";
import { dashboardPathFor, normalizeRole } from "../../shared/roles";
import { usePlatform } from "../contexts/PlatformContext";

const DEMO_ACCOUNTS = [
  { email: "citizen@demo.bahadvisory.test", role: "Citizen" },
  { email: "lgu.admin@demo.bahadvisory.test", role: "LGU Administrator (Calapan City)" },
  { email: "lgu.staff@demo.bahadvisory.test", role: "LGU Staff (Calapan City)" },
  { email: "business.admin@demo.bahadvisory.test", role: "Business Administrator" },
  { email: "enterprise.admin@demo.bahadvisory.test", role: "Enterprise Administrator" },
  { email: "super@demo.bahadvisory.test", role: "Platform Super Admin" },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const platform = usePlatform();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const from = (location.state as { from?: string } | null)?.from;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const cred = await login(email, password);
      const claims = await getClaims(cred.user);
      navigate(from ?? dashboardPathFor(normalizeRole(claims.role)), { replace: true });
    } catch {
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-card__logo" src="/logo/bahadvisory_logo.png" alt="Bahadvisory" />
        <p className="login-card__subtitle">
          Sign in to save places, get alerts near you, report flooding, or open your organization's dashboard.
        </p>
        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="login-card__links">
          <Link to="/reset-password">Forgot password?</Link>
          <Link to="/register">Create a free account</Link>
        </div>
        {platform.demoMode && (
          <details className="login-card__demo">
            <summary>Demo accounts</summary>
            <p className="tiny">
              Password: the value of <code>DEMO_ACCOUNT_PASSWORD</code> used when the demo was seeded.
            </p>
            <ul className="list-plain">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEmail(a.email)}>
                    {a.email}
                  </button>
                  <span className="tiny"> {a.role}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <Link className="login-card__back" to="/">
          ← Back to public map
        </Link>
      </div>
    </div>
  );
}
