export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

export function authCookieOptions(appUrl: string, maxAgeSeconds: number) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: appUrl.startsWith("https://"),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
