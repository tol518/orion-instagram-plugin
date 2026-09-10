import assert from "node:assert/strict";
import test from "node:test";
import {
  createActionDecisionHandler,
  createOperatorAuthentication,
  createOperatorRouter,
} from "../src/plugin/index.js";
import plugin from "../src/plugin/index.js";

test("dashboard remains available while the Instagram service is disconnected", async () => {
  const router = createOperatorRouter(null);
  const layer = router.stack.find((entry) => entry.route?.path === "/overview");
  const result = {};
  await layer.route.stack[0].handle({}, { json(body) { result.body = body; } });
  assert.deepEqual(result.body, {
    ok: true,
    data: {
      state: "not_configured",
      connected: false,
      health: { service: "instagram-mcp", writes_enabled: false, dry_run: true },
      pending: [],
      pending_available: true,
    },
  });
});

test("connected operator routes require the independent ingress credential", () => {
  const token = "i".repeat(64);
  const authenticate = createOperatorAuthentication(token);
  const result = {};
  const response = {
    status(status) {
      result.status = status;
      return this;
    },
    set(name, value) {
      result[name] = value;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  let proceeded = false;

  authenticate({ headers: {} }, response, () => {
    proceeded = true;
  });
  assert.equal(proceeded, false);
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, "AUTHENTICATION_FAILED");

  authenticate(
    { headers: { authorization: `Bearer ${token}` } },
    response,
    () => {
      proceeded = true;
    },
  );
  assert.equal(proceeded, true);
});

test("operator authentication does not intercept dashboard assets", () => {
  const router = createOperatorRouter(
    { request: async () => ({}) },
    "i".repeat(64),
  );
  assert.equal(
    router.stack.some((entry) => !entry.route && entry.name !== "expressInit"),
    false,
  );
  assert.equal(
    router.stack.some((entry) => entry.route?.path === "/assets/instagram.js"),
    false,
  );
});

test("queue failure preserves service health and emergency controls", async () => {
  const router = createOperatorRouter({
    async request(path) {
      if (path === "/health") {
        return { service: "instagram-mcp", writes_enabled: true, dry_run: false };
      }
      throw new Error("queue unavailable");
    },
  });
  const layer = router.stack.find((entry) => entry.route?.path === "/overview");
  const result = {};
  await layer.route.stack[0].handle({}, { json(body) { result.body = body; } });

  assert.deepEqual(result.body, {
    ok: true,
    data: {
      state: "connected",
      connected: true,
      health: { service: "instagram-mcp", writes_enabled: true, dry_run: false },
      pending: [],
      pending_available: false,
    },
  });
});

test("plugin registers its API and sidebar contribution without credentials", () => {
  const originalToken = process.env.ORION_INSTAGRAM_OPERATOR_TOKEN;
  delete process.env.ORION_INSTAGRAM_OPERATOR_TOKEN;
  const calls = [];
  try {
    plugin.initialize({
      logger: { warn(message) { calls.push(["warn", message]); } },
      mountApi(router) { calls.push(["api", typeof router]); },
      mountAssets(directory) { calls.push(["assets", directory]); },
      registerUi(contribution) { calls.push(["ui", contribution]); },
    });
  } finally {
    if (originalToken === undefined) delete process.env.ORION_INSTAGRAM_OPERATOR_TOKEN;
    else process.env.ORION_INSTAGRAM_OPERATOR_TOKEN = originalToken;
  }

  assert.equal(calls.find(([kind]) => kind === "api")?.[1], "function");
  assert.match(calls.find(([kind]) => kind === "assets")?.[1], /ui\/dist$/);
  assert.deepEqual(calls.find(([kind]) => kind === "ui")?.[1], {
    route: "instagram",
    label: "Instagram",
    description: "Official Meta API status, approval queue, and Instagram write controls.",
    icon: "plug",
    elementName: "orion-instagram",
    modulePath: "instagram.js",
  });
});

test("disconnected dashboard rejects operator mutations", async () => {
  const router = createOperatorRouter(null);
  const layer = router.stack.find((entry) => entry.route?.path === "/kill-writes");
  const result = {};
  const response = {
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };

  await layer.route.stack[0].handle({}, response);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body.error, {
    code: "INSTAGRAM_NOT_CONFIGURED",
    message: "Connect the Instagram MCP service before using operator actions",
  });
});

test("action approval allows Meta media processing to finish", async () => {
  const calls = [];
  const handler = createActionDecisionHandler({
    async request(path, options) {
      calls.push({ path, options });
      return { status: "succeeded" };
    },
  });
  const result = {};
  const response = {
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };

  await handler(
    {
      params: {
        id: "12345678-1234-1234-1234-123456789abc",
        decision: "approve",
      },
    },
    response,
  );

  assert.deepEqual(calls, [
    {
      path: "/operator/actions/12345678-1234-1234-1234-123456789abc/approve",
      options: {
        method: "POST",
        body: {},
        operator: true,
        timeoutMs: 6_000_000,
      },
    },
  ]);
  assert.deepEqual(result.body, { ok: true, data: { status: "succeeded" } });
});

test("operator routes do not expose unexpected credential-bearing errors", async () => {
  const handler = createActionDecisionHandler({
    async request() {
      throw new Error(`Invalid header value Bearer ${"s".repeat(64)}`);
    },
  });
  const result = {};
  const response = {
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };

  await handler(
    {
      params: {
        id: "12345678-1234-1234-1234-123456789abc",
        decision: "approve",
      },
    },
    response,
  );

  assert.equal(result.status, 502);
  assert.deepEqual(result.body, {
    ok: false,
    error: {
      code: "INSTAGRAM_UNAVAILABLE",
      message: "Instagram service request failed",
    },
  });
});
