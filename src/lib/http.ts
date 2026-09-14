export class SafeError extends Error {}

export async function request(
  url: URL,
  init: RequestInit = {},
  label = "Remote service",
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      if (attempt < 2) {
        await pause(1000 * 2 ** attempt);
        continue;
      }
      throw new SafeError(
        `${label}: network error or timeout; check connection and retry`,
      );
    }
    if (response.ok) return response;
    if ([401, 403].includes(response.status)) {
      throw new SafeError(
        `${label}: authentication/permission failure (${response.status}); check token expiry, account ID and permissions`,
      );
    }
    const transient = response.status === 429 || response.status >= 500;
    if (transient && attempt < 2) {
      const retry = response.headers.get("retry-after");
      const seconds = retry
        ? Number(retry) || (Date.parse(retry) - Date.now()) / 1000
        : 2 ** attempt;
      await response.body?.cancel();
      if (seconds > 60)
        throw new SafeError(
          `${label}: rate limited; retry on the next scheduled run`,
        );
      await pause(Math.max(1000, Math.min(60000, seconds * 1000 || 1000)));
      continue;
    }
    // Meta often sends expired-token errors as HTTP 400. Only expose numeric codes.
    let code: number | undefined;
    try {
      const body = (await response.json()) as { error?: { code?: number } };
      code = body.error?.code;
    } catch {
      /* not JSON */
    }
    throw new SafeError(
      `${label}: HTTP ${response.status}${typeof code === "number" ? ` (API code ${code})` : ""}. ${code === 190 ? "Token expired or invalid; reauthorize the account." : "Check configuration, permissions and service status."}`,
    );
  }
  throw new SafeError(`${label}: retries exhausted`);
}
export const pause = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
