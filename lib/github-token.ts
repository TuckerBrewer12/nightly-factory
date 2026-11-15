// GitHub's OAuth token grant. A GitHub App's user token comes with expires_in
// (8 hours) and a refresh_token (6 months); an OAuth App's token has neither.
export type TokenGrant = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
};

export function grantTimes(g: TokenGrant, now = Date.now()) {
  return {
    tokenExp: g.expires_in ? now + g.expires_in * 1000 : undefined,
    refresh: g.refresh_token,
    refreshExp: g.refresh_token_expires_in ? now + g.refresh_token_expires_in * 1000 : undefined,
  };
}

export async function refreshGrant(refreshToken: string): Promise<TokenGrant | null> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const g = (await res.json()) as TokenGrant;
  return g.access_token ? g : null;
}
