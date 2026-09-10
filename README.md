# Orion Instagram

Orion Instagram is the companion plugin for the standalone `orion-instagram-mcp` service. It follows the same ownership pattern as Orion Finance Lab: Orion discovers an independent plugin package, while OpenClaw links a dedicated tool plugin from that package.

This repository contains no Meta credentials, no Instagram API client, and no Instagram state. Those belong to `orion-instagram-mcp`.

## Surfaces

```text
orion-instagram-plugin/
├── src/plugin/          Orion operator API and dashboard contribution
├── ui/                  Orion Instagram dashboard
└── openclaw-plugin/     permission-scoped agent tools
```

The Orion contribution adds Instagram to the sidebar and provides status, setup guidance, pending approvals, approve/reject controls, and emergency write shutdown. It loads in a safe disconnected state before Meta credentials are available. The OpenClaw plugin exposes the fixed Instagram MCP tool catalog to agents and binds each trusted OpenClaw `agentId` to its own service credential and permission set.

An approval can remain open while Meta processes a maximum-size carousel. Keep the Orion operator connection behind infrastructure that permits long-running requests.

Instagram extraction uses official Meta reads and authenticated webhook events through the standalone service. It does not scrape Instagram or automate a browser.

## Install for Orion

```bash
npm ci
npm --prefix ui ci
npm run build
```

Add the project to Orion's existing plugin search path and provide the operator connection in Orion's private environment:

```dotenv
ORION_PLUGIN_PATHS=/absolute/path/to/orion-instagram-plugin
ORION_INSTAGRAM_API_URL=http://127.0.0.1:4840
ORION_INSTAGRAM_OPERATOR_TOKEN=<64+ CHARACTER OPERATOR TOKEN>
ORION_INSTAGRAM_API_TOKEN=<DIFFERENT 64+ CHARACTER ORION INGRESS TOKEN>
```

The operator token must match `INSTAGRAM_OPERATOR_TOKEN` in `orion-instagram-mcp`. The ingress token protects Orion's plugin routes before the private operator token is attached upstream; enter it in the dashboard unlock screen when connected. The browser keeps it only in memory. The two tokens must differ. Keep the service on an approved local host and restart Orion after changing plugin paths or environment configuration.

When either token is absent, the sidebar and dashboard still load. Status stays disconnected, all writes stay disabled, and no request is sent to Meta.

## Install agent tools for OpenClaw

```bash
npm --prefix openclaw-plugin ci --legacy-peer-deps
openclaw plugins install --link /absolute/path/to/orion-instagram-plugin/openclaw-plugin
```

Configure the plugin under `plugins.entries.orion-instagram.config`:

```json
{
  "serviceUrl": "http://127.0.0.1:4840",
  "agentTokens": {
    "orion-marketing": {
      "source": "env",
      "provider": "default",
      "id": "ORION_INSTAGRAM_MARKETING_TOKEN"
    }
  },
  "defaultPermissions": [
    "account.read",
    "media.read",
    "comments.read",
    "history.read",
    "events.read"
  ],
  "agentPermissions": {
    "orion-marketing": [
      "account.read",
      "media.read",
      "comments.read",
      "messages.read",
      "history.read",
      "events.read",
      "comments.write",
      "messages.write"
    ]
  }
}
```

Set `ORION_INSTAGRAM_MARKETING_TOKEN` in the private OpenClaw gateway environment. Put the same agent ID, resolved token, and permissions in `INSTAGRAM_BRIDGE_KEYS` on the standalone service. The plugin does not trust an agent ID passed as a tool argument; it uses the runtime-provided agent identity. OpenClaw secret references can also use a configured file or exec provider.

All tools are optional, so OpenClaw tool allowlists remain an additional gate. Restart the gateway and inspect the runtime after installation:

```bash
openclaw plugins inspect orion-instagram --runtime --json
openclaw gateway status --deep --require-rpc
```

## Test

```bash
npm run check
```

The tests and dashboard build require no Meta account.
