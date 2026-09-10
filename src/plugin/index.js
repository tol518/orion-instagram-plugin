import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInstagramClient } from "../client.js";

// Ten sequential carousel children plus the parent can each need four polling
// intervals and bounded Meta read retries. Keep the connection above that limit.
const ACTION_APPROVAL_TIMEOUT_MS = 100 * 60_000;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const plugin = {
  id: "orion.instagram",
  name: "Orion Instagram",
  version: "0.1.0",
  description:
    "Operator bridge for Instagram proposals, approval, status, and emergency write shutdown.",
  initialize(context) {
    const operatorToken = process.env.ORION_INSTAGRAM_OPERATOR_TOKEN;
    const apiToken = process.env.ORION_INSTAGRAM_API_TOKEN;
    let client = null;
    if (!operatorToken || !apiToken) {
      context.logger.warn(
        "[orion-instagram] operator credentials unset; dashboard works in disconnected mode",
      );
    } else if (
      operatorToken.length < 64 ||
      apiToken.length < 64 ||
      operatorToken === apiToken
    ) {
      throw new Error(
        "Orion Instagram requires two different tokens of at least 64 characters",
      );
    } else {
      client = createInstagramClient({
        serviceUrl:
          process.env.ORION_INSTAGRAM_API_URL ?? "http://127.0.0.1:4840",
        token: operatorToken,
      });
    }
    context.mountApi(createOperatorRouter(client, client ? apiToken : null));
    context.mountAssets(path.join(rootDir, "ui", "dist"));
    context.registerUi({
      route: "instagram",
      label: "Instagram",
      description:
        "Official Meta API status, approval queue, and Instagram write controls.",
      icon: "plug",
      elementName: "orion-instagram",
      modulePath: "instagram.js",
    });
  },
};

export function createOperatorRouter(client, apiToken = null) {
  const router = express.Router();
  const authentication =
    client && apiToken ? [createOperatorAuthentication(apiToken)] : [];
  router.get("/overview", ...authentication, async (_request, response) => {
    if (!client) {
      return response.json({ ok: true, data: disconnectedOverview("not_configured") });
    }
    let health;
    try {
      health = await client.request("/health");
    } catch {
      return response.json({ ok: true, data: disconnectedOverview("unavailable") });
    }
    try {
      const pendingResponse = await client.request("/operator/pending", {
        operator: true,
      });
      return response.json({
        ok: true,
        data: {
          state: "connected",
          connected: true,
          health,
          pending: Array.isArray(pendingResponse?.data) ? pendingResponse.data : [],
          pending_available: true,
        },
      });
    } catch {
      return response.json({
        ok: true,
        data: {
          state: "connected",
          connected: true,
          health,
          pending: [],
          pending_available: false,
        },
      });
    }
  });
  router.get("/status", ...authentication, async (_request, response) => {
    if (!client) {
      return response.json({
        ok: true,
        data: disconnectedOverview("not_configured").health,
      });
    }
    return forward(response, () => client.request("/health"));
  });
  router.get("/pending", ...authentication, async (_request, response) => {
    if (!client) return response.json({ ok: true, data: { data: [] } });
    return forward(response, () => client.request("/operator/pending", { operator: true }));
  });
  router.post(
    "/actions/:id/:decision",
    ...authentication,
    requireConnection(client, createActionDecisionHandler),
  );
  router.post(
    "/kill-writes",
    ...authentication,
    async (_request, response) =>
      client
        ? forward(response, () =>
            client.request("/operator/kill-writes", {
              method: "POST",
              body: {},
              operator: true,
            }),
          )
        : unavailable(response),
  );
  return router;
}

function disconnectedOverview(state) {
  return {
    state,
    connected: false,
    health: { service: "instagram-mcp", writes_enabled: false, dry_run: true },
    pending: [],
    pending_available: true,
  };
}

function requireConnection(client, handlerFactory) {
  if (!client) return (_request, response) => unavailable(response);
  return handlerFactory(client);
}

function unavailable(response) {
  return response.status(503).json({
    ok: false,
    error: {
      code: "INSTAGRAM_NOT_CONFIGURED",
      message: "Connect the Instagram MCP service before using operator actions",
    },
  });
}

export function createActionDecisionHandler(client) {
  return async (request, response) => {
    if (
      !/^[0-9a-f-]{36}$/i.test(request.params.id) ||
      !new Set(["approve", "reject"]).has(request.params.decision)
    ) {
      return response
        .status(400)
        .json({ ok: false, error: "Invalid action request" });
    }
    return forward(response, () =>
      client.request(
        `/operator/actions/${request.params.id}/${request.params.decision}`,
        {
          method: "POST",
          body: {},
          operator: true,
          timeoutMs:
            request.params.decision === "approve"
              ? ACTION_APPROVAL_TIMEOUT_MS
              : 30_000,
        },
      ),
    );
  };
}

export function createOperatorAuthentication(apiToken) {
  return (request, response, next) => {
    const authorization = request.headers.authorization;
    const supplied = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!equal(supplied, apiToken)) {
      return response
        .status(401)
        .set("WWW-Authenticate", "Bearer")
        .json({
          ok: false,
          error: {
            code: "AUTHENTICATION_FAILED",
            message: "Operator authentication is required",
          },
        });
    }
    next();
  };
}

function equal(left, right) {
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

async function forward(response, operation) {
  try {
    return response.json({ ok: true, data: await operation() });
  } catch (error) {
    const exposed = error?.expose === true;
    return response.status(502).json({
      ok: false,
      error: {
        code:
          exposed && typeof error.code === "string"
            ? error.code
            : "INSTAGRAM_UNAVAILABLE",
        message: exposed ? error.message : "Instagram service request failed",
      },
    });
  }
}

export default plugin;
