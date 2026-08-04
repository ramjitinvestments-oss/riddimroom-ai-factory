/**
 * Admin API access token acquisition via Shopify's OAuth client
 * credentials grant — the replacement for the retired admin-created
 * custom app static token (see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant).
 * Unlike a static token, a client-credentials token expires (Shopify
 * currently fixes this at 86399s / ~24h), so callers never hold a token
 * themselves — they always go through `getToken()`, which transparently
 * reuses a cached token or refreshes it once it's within
 * `refreshBufferMs` of expiring.
 */
import { ExternalServiceError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { withRetry } from "../shared/retry.ts";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
/** Refresh this long before actual expiry, so a slow request never straddles it. */
const DEFAULT_REFRESH_BUFFER_MS = 60_000;

/** Anything `ShopifyApiProvider` needs from the authentication layer: a valid, current token. */
export interface AccessTokenProvider {
  getToken(): Promise<Result<string, ExternalServiceError>>;
}

export interface ClientCredentialsTokenProviderOptions {
  readonly storeDomain: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly refreshBufferMs?: number;
  /** Injectable fetch implementation, so tests never hit the real network. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable clock (epoch ms), for tests. */
  readonly now?: () => number;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

interface TokenResponseBody {
  readonly access_token?: string;
  readonly expires_in?: number;
}

/**
 * Fetches and caches Admin API access tokens via `POST
 * /admin/oauth/access_token` with `grant_type=client_credentials`.
 */
export class ClientCredentialsTokenProvider implements AccessTokenProvider {
  private readonly storeDomain: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly refreshBufferMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private cached: CachedToken | null = null;
  private pending: Promise<Result<string, ExternalServiceError>> | null = null;

  constructor(options: ClientCredentialsTokenProviderOptions) {
    this.storeDomain = options.storeDomain;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.refreshBufferMs = options.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns a valid access token: the cached one if it's not within
   * `refreshBufferMs` of expiring, otherwise a freshly fetched one.
   * Concurrent calls during a refresh share the same in-flight request
   * rather than issuing duplicate token requests.
   */
  async getToken(): Promise<Result<string, ExternalServiceError>> {
    if (this.cached !== null && this.now() < this.cached.expiresAtMs - this.refreshBufferMs) {
      return ok(this.cached.accessToken);
    }

    if (this.pending === null) {
      this.pending = this.fetchToken().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async fetchToken(): Promise<Result<string, ExternalServiceError>> {
    try {
      const { accessToken, expiresInSeconds } = await withRetry(() => this.requestToken(), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.baseDelayMs,
        isRetryable,
      });
      this.cached = { accessToken, expiresAtMs: this.now() + expiresInSeconds * 1000 };
      return ok(accessToken);
    } catch (error) {
      if (error instanceof ExternalServiceError) {
        return err(error);
      }
      return err(
        new ExternalServiceError("shopify", "client credentials token request failed", { cause: error }),
      );
    }
  }

  private async requestToken(): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const url = `https://${this.storeDomain}/admin/oauth/access_token`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
        }),
      });
    } catch (error) {
      throw new ExternalServiceError("shopify", "token request network failure", { cause: error });
    }

    if (!response.ok) {
      const bodyText = await safeReadText(response);
      throw new ExternalServiceError("shopify", `token request failed: ${response.status} ${bodyText}`, {
        statusCode: response.status,
      });
    }

    let body: TokenResponseBody;
    try {
      body = (await response.json()) as TokenResponseBody;
    } catch {
      throw new ExternalServiceError("shopify", "token response body was not valid JSON");
    }

    if (body.access_token === undefined || body.access_token.length === 0) {
      throw new ExternalServiceError("shopify", "token response did not include an access_token");
    }

    return {
      accessToken: body.access_token,
      // Shopify currently always returns 86399 (24h); fall back to that if a mock/response omits it.
      expiresInSeconds: body.expires_in ?? 86399,
    };
  }
}

/** 429 (rate limited) and 5xx are worth retrying; a bare network failure (no status) is too. 4xx otherwise is not. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ExternalServiceError)) {
    return false;
  }
  if (error.statusCode === undefined) {
    return true;
  }
  return error.statusCode === 429 || error.statusCode >= 500;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no response body>";
  }
}
