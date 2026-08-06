import { useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/button.tsx";
import { authClient } from "./auth-client.ts";

type AccountScreenProps = {
  name: string;
  email: string;
  onBack: () => void;
  onSignedOut: () => Promise<void>;
};

export function AccountScreen({ name, email, onBack, onSignedOut }: AccountScreenProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function changePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword !== confirmation) {
      setError("Passwords do not match");
      return;
    }
    setPending(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) setError(result.error.message ?? "Could not change password");
      else {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
        setNotice("Password changed and other sessions signed out.");
      }
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Could not change password");
    } finally {
      setPending(false);
    }
  }

  async function signOut(): Promise<void> {
    setSigningOut(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError(result.error.message ?? "Could not log out");
      else await onSignedOut();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Could not log out");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="account-page">
      <section className="account-card panel">
        <div className="section-heading">
          <div>
            <h1>Account</h1>
            <p>{name} · {email}</p>
          </div>
          <Button variant="outline" onClick={onBack}>Back</Button>
        </div>

        <form onSubmit={(event) => void changePassword(event)}>
          <h2>Change password</h2>
          <label>
            Current password
            <input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>
          <label>
            New password
            <input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <label>
            Confirm new password
            <input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          {error && <p className="error-message">{error}</p>}
          {notice && <p className="success-message">{notice}</p>}
          <Button disabled={pending}>{pending ? "Changing…" : "Change password"}</Button>
        </form>

        <Button variant="destructive" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? "Logging out…" : "Log out"}
        </Button>
      </section>
    </main>
  );
}
