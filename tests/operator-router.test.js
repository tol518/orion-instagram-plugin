import assert from "node:assert/strict";
import test from "node:test";
import {
  createActionDecisionHandler,
  createOperatorAuthentication,
} from "../src/plugin/index.js";

test("operator routes require the independent ingress credential", () => {
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
  assert.deepEqual(result, {
    status: 401,
    "WWW-Authenticate": "Bearer",
    body: {
      ok: false,
      error: {
        code: "AUTHENTICATION_FAILED",
        message: "Operator authentication is required",
      },
    },
  });

  authenticate(
    { headers: { authorization: `Bearer ${token}` } },
    response,
    () => {
      proceeded = true;
    },
  );
  assert.equal(proceeded, true);
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
