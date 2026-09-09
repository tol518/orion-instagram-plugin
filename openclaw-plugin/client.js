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
  if (
    !new Set(["http:", "https:"]).has(parsed.protocol) ||
    !LOCAL_HOSTS.has(parsed.hostname)
  ) {
    throw new Error(
      "Instagram service URL must use an approved local HTTP(S) host",
    );
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/") {
    throw new Error(
      "Instagram service URL must not contain credentials or a path",
    );
  }
  if (typeof token !== "string" || !/^[!-~]{64,}$/.test(token)) {
    throw clientError(
      "Instagram agent bridge token must contain at least 64 printable ASCII characters",
      "AUTHENTICATION_FAILED",
    );
  }
  return {
    async invoke(toolName, body, signal) {
      let response;
      try {
        response = await fetch(
          `${baseUrl}/tools/${encodeURIComponent(toolName)}`,
          {
            method: "POST",
            redirect: "error",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
              : AbortSignal.timeout(timeoutMs),
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
        );
      } catch {
        throw clientError(
          "Instagram service could not be reached or timed out",
          "INSTAGRAM_REQUEST_FAILED",
        );
      }
      const raw = await response.text();
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
        const error = clientError(
          payload?.error?.message ??
            `Instagram service request failed (${response.status})`,
          payload?.error?.code ?? "INSTAGRAM_REQUEST_FAILED",
        );
        error.actionId = payload?.action_id;
        throw error;
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

export function resolveAgentPermissions(config, agentId, knownPermissions) {
  const explicit = config.agentPermissions?.[agentId];
  const source = Array.isArray(explicit)
    ? explicit
    : (config.defaultPermissions ?? []);
  return [
    ...new Set(source.filter((permission) => knownPermissions.has(permission))),
  ];
}
