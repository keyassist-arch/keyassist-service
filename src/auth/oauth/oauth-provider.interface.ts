/**
 * Optional OAuth provider contract. Wire concrete strategies (Google, etc.)
 * without changing core auth flows.
 */
export interface OAuthUserProfile {
  providerId: string;
  email: string;
  displayName?: string;
}

export interface OAuthProvider {
  readonly name: string;
  validateAccessToken(accessToken: string): Promise<OAuthUserProfile>;
}
