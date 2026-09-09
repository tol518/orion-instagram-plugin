import { Agent } from "undici";

const LOCAL_HOSTS = new Set([
  "127.0.0.1",
  "[::1]",
  "localhost",
  "host.docker.internal",
  "instagram-mcp",
]);

export function createInstagramClient({
  serviceUrl,
  token,
  timeoutMs = 30_000,
}) {
  const baseUrl = String(serviceUrl).replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("Instagram service URL must be HTTP(S)");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("Instagram service URL must use an approved local host");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/") {
    throw new Error(
      "Instagram service URL must not contain credentials or a path",
    );
  }
  if (typeof token !== "string" || !/^[!-~]{64,}$/.test(token)) {
    throw clientError(
      "Instagram bridge token must contain at least 64 printable ASCII characters",
      "AUTHENTICATION_FAILED",
    );
  }

  return {
    async request(
      path,
      {
        method = "GET",
        body,
        signal,
        operator = false,
        timeoutMs: requestTimeoutMs = timeoutMs,
      } = {},
    ) {
      const timeout = AbortSignal.timeout(requestTimeoutMs);
      const dispatcher = new Agent({
        headersTimeout: requestTimeoutMs,
        bodyTimeout: requestTimeoutMs,
      });
      let response;
      let raw;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method,
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          dispatcher,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        raw = await response.text();
      } catch {
        throw clientError(
          "Instagram service could not be reached or timed out",
          operator ? "OPERATOR_REQUEST_FAILED" : "INSTAGRAM_REQUEST_FAILED",
        );
      } finally {
        await dispatcher.close();
      }
      if (raw.length > 2_000_000)
        throw clientError(
          "Instagram service response is too large",
          "INSTAGRAM_REQUEST_FAILED",
        );
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw clientError(
          "Instagram service returned an unreadable response",
          "INSTAGRAM_REQUEST_FAILED",
        );
      }
      if (!response.ok || payload?.success === false) {
        throw clientError(
          payload?.error?.message ??
            `Instagram service request failed (${response.status})`,
          payload?.error?.code ??
            (operator ? "OPERATOR_REQUEST_FAILED" : "INSTAGRAM_REQUEST_FAILED"),
        );
      }
      return payload;
    },
  };
}

function clientError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.expose = true;
  return error;
}
