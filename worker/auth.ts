import { waitUntil } from "cloudflare:workers";
import { betterAuth } from "better-auth";

export function createAuth(env: Env, origin: string) {
  return betterAuth({
    appName: "Project D",
    baseURL: origin,
    trustedOrigins: [origin],
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        waitUntil(env.EMAIL.send({
          to: user.email,
          from: { email: env.AUTH_EMAIL_FROM, name: "Project D" },
          subject: "Reset your Project D password",
          text: `Reset your Project D password: ${url}\n\nThis link expires in one hour. If you did not request it, ignore this email.`,
          html: `<p>Reset your Project D password:</p><p><a href="${escapeHtml(url)}">Reset password</a></p><p>This link expires in one hour. If you did not request it, ignore this email.</p>`,
        }).catch((error: unknown) => {
          console.error(JSON.stringify({
            message: "password reset email failed",
            error: error instanceof Error ? error.message : String(error),
          }));
        }));
      },
    },
    rateLimit: {
      storage: "database",
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
