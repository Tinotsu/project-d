import { useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/button.tsx";
import { authClient } from "./auth-client.ts";

export type AuthScreenMode = "login" | "signup" | "forgot-password" | "reset-password";

type AuthScreenProps = {
  mode: AuthScreenMode;
  onAuthenticated: () => Promise<void>;
  onNavigate: (mode: AuthScreenMode) => void;
  onHome: () => void;
};

export function AuthScreen({ mode, onAuthenticated, onNavigate, onHome }: AuthScreenProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const token = new URLSearchParams(window.location.search).get("token");
  const resetError = new URLSearchParams(window.location.search).get("error");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setNotice("");
    if ((mode === "signup" || mode === "reset-password") && password !== confirmation) {
      setError("Passwords do not match");
      return;
    }

    setPending(true);
    try {
      if (mode === "login") {
        const result = await authClient.signIn.email({ email, password, rememberMe: true });
        if (result.error) setError(result.error.message ?? "Could not log in");
        else await onAuthenticated();
      } else if (mode === "signup") {
        const result = await authClient.signUp.email({ name, email, password });
        if (result.error) setError(result.error.message ?? "Could not create account");
        else await onAuthenticated();
      } else if (mode === "forgot-password") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error) setError(result.error.message ?? "Could not request a password reset");
        else setNotice("If that account exists, a password reset link has been sent.");
      } else {
        if (!token) {
          setError("This password reset link is missing or invalid");
          return;
        }
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) setError(result.error.message ?? "Could not reset password");
        else {
          setNotice("Password reset. You can now log in.");
          setPassword("");
          setConfirmation("");
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication request failed");
    } finally {
      setPending(false);
    }
  }

  const title = mode === "login"
    ? "Log in"
    : mode === "signup"
      ? "Create account"
      : mode === "forgot-password"
        ? "Recover account"
        : "Reset password";

  return (
    <main className="auth-page">
      <form className="auth-card panel" onSubmit={(event) => void submit(event)}>
        <div>
          <h1>{title}</h1>
          <p>
            {mode === "forgot-password"
              ? "Enter your email and we’ll send you a reset link."
              : mode === "reset-password"
                ? "Choose a new password with at least eight characters."
                : "Use email and password. No social account required."}
          </p>
        </div>

        {mode === "signup" && (
          <label>
            Display name
            <input required maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        )}

        {mode !== "reset-password" && (
          <label>
            Email
            <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
        )}

        {mode !== "forgot-password" && (
          <label>
            Password
            <input
              required
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}

        {(mode === "signup" || mode === "reset-password") && (
          <label>
            Confirm password
            <input
              required
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        )}

        {(error || resetError) && <p className="error-message">{error || "This password reset link has expired or is invalid"}</p>}
        {notice && <p className="success-message">{notice}</p>}
        <Button disabled={pending || (mode === "reset-password" && !token)}>
          {pending ? "Please wait…" : title}
        </Button>

        <div className="auth-links">
          {mode === "login" && (
            <>
              <button type="button" onClick={() => onNavigate("forgot-password")}>Forgot password?</button>
              <button type="button" onClick={() => onNavigate("signup")}>Create an account</button>
            </>
          )}
          {mode === "signup" && <button type="button" onClick={() => onNavigate("login")}>Already have an account?</button>}
          {(mode === "forgot-password" || mode === "reset-password") && (
            <button type="button" onClick={() => onNavigate("login")}>Back to login</button>
          )}
          <button type="button" onClick={onHome}>Back to Project D</button>
        </div>
      </form>
    </main>
  );
}
