# Bring-Your-Own-Claude + MCP State of the Art (September 2026)

Research brief for an open-source, AI-native desktop alternative to Meta's Origami Studio.
Research date: 2026-09-16. All URLs fetched on that date unless noted. Revised 2026-09-20: the ratings in the TL;DR (item 7), 2.3 and 2.4 now weigh support article D, and section 2.6 describes the experimental subscription option Sonobe built, which stays off until Anthropic agrees.

Legend: **[VERIFIED]** = seen in a primary source (URL cited). **[VERIFIED-2nd]** = seen only in secondary press/blogs. **[INFERRED]** = my reasoning or synthesis, not stated by a source.

---

## 0. TL;DR and recommendation

1. **The cleanest compliant "bring your own Claude subscription" path is MCP, not login.** The user runs Anthropic's own apps (Claude Desktop, Claude Code, or claude.ai) signed in with *their* Pro/Max plan, and those apps connect to *our* MCP server. No API key, no Anthropic credentials ever touch our app. **[INFERRED from the policy wording in section 2]**
2. **Anthropic explicitly forbids third-party apps offering "Sign in with Claude.ai", routing requests through Free/Pro/Max credentials, or collecting/storing/intermediating claude.ai tokens.** Exact wording is in section 2.1. **[VERIFIED]** https://code.claude.com/docs/en/legal-and-compliance
3. **The MCP spec changed a lot.** The current revision is **`2026-07-28`**. MCP is now **stateless**: no `initialize` handshake, no `Mcp-Session-Id`. It adds `server/discover`, `subscriptions/listen`, and Multi Round-Trip Requests (MRTR) for elicitation/sampling. Tasks moved into an extension. **Roots, Sampling, Logging and Dynamic Client Registration are deprecated.** **[VERIFIED]** https://modelcontextprotocol.io/specification/2026-07-28/changelog
4. **The TypeScript SDK is now v2 and split into packages.** `@modelcontextprotocol/server` 2.0.0 and `@modelcontextprotocol/client` 2.0.0 were released 2026-07-27, alongside middleware packages `@modelcontextprotocol/node|express|hono|fastify`. v1 `@modelcontextprotocol/sdk` is at 1.30.0 and gets fixes for at least 6 months. **[VERIFIED]** npm registry + https://github.com/modelcontextprotocol/typescript-sdk
5. **Claude.ai web "custom connectors" cannot reach localhost.** Connections originate from Anthropic's cloud. To talk to a live local document, use **Claude Desktop local extensions (MCPB/stdio)** or **Claude Code (`claude mcp add` stdio or http to 127.0.0.1)**. **[VERIFIED]** https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
6. **Recommended architecture:**
   - The app hosts an in-process MCP server on Streamable HTTP, bound to `127.0.0.1`, with Host/Origin validation and a bearer token.
   - A tiny **stdio shim** binary forwards to the running app. It is packaged as an **`.mcpb` Desktop Extension** for one-click Claude Desktop install, and shipped as a **Claude Code plugin** (`.mcp.json` + skills).
   - Optionally, an **MCP App** (`ui://` resource) renders an interactive prototype preview inline in Claude Desktop and claude.ai.
   **[INFERRED design, built on VERIFIED capabilities]**
7. **In-app chat:** ship it as optional, **BYO Anthropic API key** only, using `@anthropic-ai/sdk` (0.126.0) plus its `mcpTools()` helper so it drives our own MCP server. Model IDs: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`. Do **not** silently drive the user's subscription-authenticated Claude Code headlessly as a hidden harness (policy gray zone, section 2.5). A user-initiated "Open in Claude Code" button is fine. **[INFERRED recommendation]**
   **Revised 2026-09-20:** support article D says "For now, nothing has changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription's usage limits", so Anthropic's own support pages describe third-party apps running on a subscription and say how that usage counts. Doc B still says third-party developers may not offer claude.ai login "unless previously approved". Doc A says Anthropic "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users", with no exception in that paragraph. Sonobe has built the option, as an ACP client of Claude's agent adapter that the person installs and signs in to themselves (section 2.6). Whether it routes requests through the person's plan credentials on their behalf, which A bars, is the open question for Anthropic, so the option stays off by default and unreleased until Anthropic agrees (packaged builds hide its switch). **[INFERRED; the permission is Anthropic's to give]**

---

## 1. Connecting a local app to Claude surfaces (what works on Pro/Max with no API key)

### 1.0 Summary matrix

| Surface | How our app connects | Local/live doc reachable? | Pro/Max no API key? | One-click? | Notes |
|---|---|---|---|---|---|
| **Claude Desktop** (macOS/Windows) | Local MCP server via **Desktop Extension `.mcpb`** or `claude_desktop_config.json` (stdio `command`/`args`) | **Yes** (process on user's machine) | **Yes** | **Yes** (`.mcpb` double-click / Settings > Extensions) | Supports MCP Apps (inline UI). **[VERIFIED]** |
| **Claude Code** (CLI, IDE extensions, desktop) | `claude mcp add` (stdio or `--transport http http://127.0.0.1:PORT/mcp`), project `.mcp.json`, or **plugin** bundling `.mcp.json` + skills | **Yes** | **Yes** (subscription OAuth via `/login`) | Semi (a copy-paste command, or `/plugin install`) | v2 runtime (v2.1.232+) speaks 2026-07-28. **[VERIFIED]** |
| **claude.ai web / mobile / Cowork** | **Custom connector** = remote MCP URL (Streamable HTTP), optional OAuth | **No, not localhost.** Must be reachable on the public internet from Anthropic IPs | **Yes** (Free limited to 1 custom connector) | Paste URL | Would need a tunnel or a cloud relay. **[VERIFIED]** |
| **Messages API MCP connector** | `mcp_servers` param, beta header `mcp-client-2025-11-20` | No (public https only) | **No, API key** | n/a | Tools only. **[VERIFIED]** |
| **Agent SDK** | `mcpServers` option (stdio/http/sse/in-process) | Yes | Officially **API key** for third-party products unless approved (section 2); support article D says third-party app usage draws on the subscription (Sonobe's experimental option, 2.6) | n/a | **[VERIFIED]** |

### 1.1 Claude Desktop

#### 1.1.1 Manual config: `claude_desktop_config.json` [VERIFIED]
Source: https://modelcontextprotocol.io/docs/develop/connect-local-servers
- Open it from the **Claude menu (system menu bar) > Settings... > Developer > "Edit Config"**. This creates the file if it doesn't exist.
- Paths:
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Format (verbatim example):
  ```json
  {
    "mcpServers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/username/Desktop", "/Users/username/Downloads"]
      }
    }
  }
  ```
- An `env` object is supported (e.g. `"env": { "APPDATA": "...", "BRAVE_API_KEY": "..." }`).
- **You must fully quit and restart Claude Desktop** after editing.
- Where tools show up: **"Add files, connectors, and more /"** in the bottom-left of the input box > "Connectors" > "Manage connectors".
- Logs:
  - macOS: `~/Library/Logs/Claude`; Windows: `%APPDATA%\Claude\logs`
  - `mcp.log` holds general connection logging. `mcp-server-SERVERNAME.log` holds each server's stderr.
  - `tail -n 20 -f ~/Library/Logs/Claude/mcp*.log`
- Paths in args must be absolute.
- Claude Code's docs show a config with `"type": "stdio"` for `claude mcp serve` inside `claude_desktop_config.json`. **[VERIFIED]** https://code.claude.com/docs/en/mcp
- **Remote/HTTP URLs directly in `claude_desktop_config.json`:** not documented in any primary source I found. The documented options for remote servers are Custom Connectors (cloud-originated) or a stdio bridge such as `mcp-remote`. **[INFERRED: treat Desktop config as stdio-only]**
- **DOCS-DRIFT FLAG:** this modelcontextprotocol.io tutorial still teaches hand-editing JSON. Claude's own support article (updated 2026-06-30) presents Desktop Extensions as the intended install path "instead of manually configuring JSON files." https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop

#### 1.1.2 Desktop Extensions → MCP Bundles (`.mcpb`, formerly `.dxt`) [VERIFIED]
Sources: https://github.com/modelcontextprotocol/mcpb, https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md, https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop

- **What it is:** a zip archive containing a local MCP server plus `manifest.json`. It is "spiritually similar to Chrome extensions (.crx) or VS Code extensions (.vsix), enabling end users to install local MCP servers with a single click."
- **Rename:** DXT became MCPB. The CLI went from `dxt` to `mcpb`, the extension from `.dxt` to `.mcpb`, and the npm package to `@anthropic-ai/mcpb`. Existing `.dxt` files still work (per the Anthropic engineering blog, per search snippet: https://www.anthropic.com/engineering/desktop-extensions **[VERIFIED-2nd via snippet]**).
- **CLI:** `npm install -g @anthropic-ai/mcpb`, then `mcpb init` (guided manifest creation) and `mcpb pack` (produces the `.mcpb`). The latest npm version is **2.1.2** (published 2025-12-04). **[VERIFIED npm]**
- **Server types:** `node` (recommended: "works out-of-the-box since Claude ships with Node.js"), `python` (bundled deps in `server/lib/`), `uv` (Python via UV runtime, v0.4+), and `binary` (static-linked, per-platform).
- **Manifest version:** `0.3` (MANIFEST.md last updated 2025-12-02).
  - Required fields: `manifest_version`, `name`, `version`, `description`, `author{name}`, `server`.
  - Optional fields: `display_name`, `long_description`, `icon`/`icons`, `repository`, `homepage`, `documentation`, `support`, `screenshots`, `tools`, `prompts`, `tools_generated`, `prompts_generated`, `keywords`, `license`, `privacy_policies`, `compatibility`, `user_config`, `localization`, `_meta`.
  - `server`: `{ type, entry_point, mcp_config: { command, args, env, platform_overrides } }`
  - Variable substitution: `${__dirname}`, `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}`, `${pathSeparator}` / `${/}`, `${user_config.KEY}`
  - `user_config` types: `string`, `number`, `boolean`, `directory`, `file`. Options: `title`, `description`, `required` (default false), `default`, `sensitive` (masked, stored securely), `multiple` (for directory/file), `min`/`max`.
  - `compatibility`: `{ "claude_desktop": ">=1.0.0", "platforms": ["darwin","win32","linux"], "runtimes": { "python": ">=3.8", "node": ">=16.0.0" } }`
  - Minimal manifest (verbatim):
    ```json
    {
      "manifest_version": "0.3",
      "name": "my-extension",
      "version": "1.0.0",
      "description": "A simple MCP extension",
      "author": { "name": "Extension Author" },
      "server": {
        "type": "node",
        "entry_point": "server/index.js",
        "mcp_config": { "command": "node", "args": ["${__dirname}/server/index.js"] }
      }
    }
    ```
- **Install UX:**
  - From the directory: Settings > Extensions > "Browse extensions" (Anthropic-reviewed) > Install.
  - From a custom `.mcpb`: Settings > Extensions > "Advanced settings" > Extension Developer section > "Install Extension..." > pick the `.mcpb` file. The README also says users "install bundles by opening `.mcpb` files with Claude for macOS and Windows, which displays an installation dialog."
  - Fields marked `"sensitive": true` "are automatically encrypted using the operating system's secure storage."
  - "For privately distributed extensions, users will need to install updated .mcpb files manually."
- **Distribution:** share `.mcpb` directly or submit to the directory ("Local MCP Server Submission Guide", https://support.claude.com/en/articles/12922832-local-mcp-server-submission-guide, found via search, not fetched). Team/Enterprise Owners can allowlist and upload extensions (https://support.claude.com/en/articles/12592343-enabling-and-using-the-desktop-extension-allowlist).
- **Plan availability:** the Desktop local-MCP article doesn't state plan limits explicitly. **[INFERRED: available on all plans including Free, as local MCP has historically been]**
- **Deep-link one-click install from a website:** no primary source documents a `claude://` URL that installs an `.mcpb`. A search surfaced community DeepWiki notes about a `claude://` scheme with `mcp` actions in Claude Code, but that is not authoritative. **[INFERRED: rely on file-open of `.mcpb`]**

#### 1.1.3 Desktop vs web connectors [VERIFIED]
https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors (updated 2026-08-06)
- Remote (web) connectors are for "Cloud service you sign into". They're available on web, mobile, Cowork, Desktop and Claude Code.
- Desktop extensions are for when the "tool runs on your computer—local files, a database on localhost, a desktop application". They're only available in Claude Desktop and Claude Code.
- "Plugins can bundle either type (or both)."

#### 1.1.4 MCP Apps in Claude Desktop [VERIFIED]
Claude (web) and Claude Desktop are listed as MCP Apps hosts: https://modelcontextprotocol.io/extensions/client-matrix. Details are in section 3.8.

### 1.2 Claude Code

Source for everything in 1.2 unless noted: https://code.claude.com/docs/en/mcp **[VERIFIED]**

#### 1.2.1 `claude mcp add`
```bash
# Remote HTTP (recommended for remote)
claude mcp add --transport http <name> <url>
claude mcp add --transport http <name> <url> --header "Authorization: Bearer your-token"

# SSE (deprecated)
claude mcp add --transport sse <name> <url>

# Local stdio — note the "--" separator
claude mcp add [options] <name> -- <command> [args...]
claude mcp add --env AIRTABLE_API_KEY=YOUR_KEY --transport stdio airtable -- npx -y airtable-mcp-server

# WebSocket (JSON only)
claude mcp add-json events-server '{"type":"ws","url":"wss://mcp.example.com/socket","headers":{"Authorization":"Bearer YOUR_TOKEN"}}'

# JSON form
claude mcp add-json local-weather '{"type":"stdio","command":"/path/to/weather-cli","args":["--api-key","abc123"],"env":{"CACHE_DIR":"/tmp"}}'

# Import from Claude Desktop
claude mcp add-from-claude-desktop [--scope user]

# Manage
claude mcp list | get <name> | remove <name> [--scope <scope>] | reset-project-choices
claude mcp login <name> [--no-browser] ; claude mcp logout <name>
claude mcp serve        # Claude Code itself as a stdio MCP server
```
- Short flags: `-t/--transport` (http, sse, stdio, ws), `-H/--header`, `-s/--scope`, `-e/--env`.
- OAuth options: `--client-id`, `--client-secret` (or `MCP_CLIENT_SECRET` env), `--callback-port`. Interactive login runs through the `/mcp` panel.
- Server names may contain only letters, numbers, hyphens and underscores.

#### 1.2.2 Scopes and files
| Scope | Loads in | Shared | Storage |
|---|---|---|---|
| `local` (default) | current project | No | `~/.claude.json` |
| `project` | current project | Yes, via git | `.mcp.json` at project root |
| `user` | all projects | No | `~/.claude.json` |

`.mcp.json` supports env expansion `${VAR}` and `${VAR:-default}`. Credential variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `NPM_TOKEN`, ...) read as empty. Example:
```json
{
  "mcpServers": {
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": { "Authorization": "Bearer ${API_KEY}" }
    }
  }
}
```
In JSON config files `"streamable-http"` is accepted as an alias for `"http"` (https://code.claude.com/docs/en/agent-sdk/mcp).

#### 1.2.3 `headersHelper` (useful for rotating localhost tokens)
```json
{ "mcpServers": { "internal-api": { "type": "http", "url": "https://mcp.internal.example.com", "headersHelper": "/opt/bin/get-mcp-auth-headers.sh" } } }
```
The helper receives `CLAUDE_CODE_MCP_SERVER_NAME`, `CLAUDE_CODE_MCP_SERVER_URL` and `CLAUDE_PLUGIN_ROOT` (for plugins), and must print a JSON object of string headers to stdout. Plugin helpers get placeholder substitution from v2.1.207+.

#### 1.2.4 Limits, timeouts, behaviors
- **Output:** `MAX_MCP_OUTPUT_TOKENS` defaults to **25,000 tokens**, with a warning at **10,000**. It is a soft limit: larger results are saved to `~/.claude/projects/<project>/tool-results/`.
  - Per-tool override from the server: `"_meta": { "anthropic/maxResultSizeChars": 200000 }`.
  - Tools returning images are still subject to `MAX_MCP_OUTPUT_TOKENS`.
- **Timeouts:**
  - `MCP_TIMEOUT` is the startup timeout in ms (Agent SDK docs: 30 s default).
  - Per-server `"timeout"` in ms is a hard wall-clock limit per tool call.
  - `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` defaults to 5 min for HTTP/SSE and 30 min for stdio; 0 disables it.
  - `MCP_TOOL_TIMEOUT` is also referenced.
- **Auto-backgrounding:** `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` defaults to 120000 (v2.1.212+). Long tool calls move to background tasks. A call waiting on an elicitation dialog isn't backgrounded.
- **Tool Search:** on by default. Claude Code selects relevant tools rather than sending every schema.
- **`list_changed`:** servers can update tools/prompts/resources without reconnecting. On the v2 runtime, notifications arrive over a persistent stream.
- **Resources:** `@`-mention resources in prompts. **Prompts** appear as `/prompt-name` slash commands.
- **Elicitation:** supported, shown as dialogs.
- **Reconnection:** remote servers reconnect with exponential backoff (5 attempts from 1 s, doubling). A failed first connection gets up to 3 retries. **Stdio servers are not auto-reconnected.**
- **Runtimes:** "The v1 runtime is built on MCP TypeScript SDK 1.x. The v2 runtime is the same code on MCP TypeScript SDK 2.0, which adds MCP protocol revision 2026-07-28." The v2 runtime needs **v2.1.232+**. The discovery cache for remote tool lists needs v2.1.221+.
- **claude.ai connectors sync:** servers added at claude.ai/customize/connectors appear in Claude Code when logged in with a claude.ai account. Disable with `ENABLE_CLAUDEAI_MCP_SERVERS=false` or `{ "disableClaudeAiConnectors": true }`.
- **Managed MCP:** `managedMcpServers`, `managed-mcp.json`, `allowedMcpServers` / `deniedMcpServers`.
- **MCP Apps rendering in Claude Code:** no section in the Claude Code MCP docs. Claude Code is absent from the extension client matrix (https://modelcontextprotocol.io/extensions/client-matrix). **[INFERRED: Claude Code does not render MCP App UIs; design tools so text/structured output stands alone]**
- Latest `@anthropic-ai/claude-code` on npm: `latest` 2.1.273, `stable` 2.1.267, `next` 2.1.274 (2026-09-15). **[VERIFIED npm]**

#### 1.2.5 Plugins and Skills (distribution to Claude Code users) [VERIFIED]
https://code.claude.com/docs/en/plugins
- Layout (only `plugin.json` goes inside `.claude-plugin/`):
  ```text
  my-plugin/
  ├── .claude-plugin/plugin.json   # {name, description, version?, author?}
  ├── skills/<name>/SKILL.md       # model-invoked skills (frontmatter: description, disable-model-invocation, ...)
  ├── commands/                    # legacy flat markdown skills
  ├── agents/                      # custom subagents
  ├── hooks/hooks.json
  ├── .mcp.json                    # MCP servers (use ${CLAUDE_PLUGIN_ROOT})
  ├── .lsp.json
  ├── monitors/monitors.json       # background monitors
  ├── bin/                         # added to Bash PATH
  └── settings.json                # only `agent`, `subagentStatusLine` keys
  ```
- Plugin MCP tool names become `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`.
- Dev loop: `claude --plugin-dir ./my-plugin` (also accepts `.zip`, a folder of plugins from v2.1.265+, and `--plugin-url https://...zip`), plus `/reload-plugins`, `claude plugin init my-tool` (scaffolds into `~/.claude/skills/my-tool/`), and `claude plugin validate ./your-plugin [--strict]`.
- Marketplaces:
  - `claude-plugins-official` is curated and auto-registered.
  - `claude-community` is added with `/plugin marketplace add anthropics/claude-plugins-community`.
  - Submit through claude.ai (Team/Enterprise) or Console `platform.claude.com/plugins/submit`.
  - Your own marketplace repo works too: `/plugin marketplace add owner/repo`, then `/plugin install name@marketplace`.
- Example of an MCP project shipping a skill via plugin: `/plugin marketplace add modelcontextprotocol/ext-apps` then `/plugin install mcp-apps@modelcontextprotocol-ext-apps` (https://modelcontextprotocol.io/extensions/apps/build).

#### 1.2.6 Channels (push events into a running Claude Code session) [VERIFIED]
https://code.claude.com/docs/en/channels-reference
- A channel is an MCP server spawned over stdio that declares `capabilities.experimental['claude/channel'] = {}` and emits `notifications/claude/channel` events.
- Optional permission relay: `experimental['claude/channel/permission']`, `notifications/claude/channel/permission_request`, and a verdict `notifications/claude/channel/permission` with `{request_id, behavior: 'allow'|'deny'}`.
- **Research preview** (shipped in v2.1.80, 2026-03-20 per secondary sources). Custom channels need `--dangerously-load-development-channels server:<name>`. The `--channels` flag is limited to an Anthropic-curated allowlist. Orgs must set `channelsEnabled`.
- **Relevance:** it could later let the app push "user selected patch X" into a Claude Code session. It is not production-ready for third parties today. **[INFERRED]**

#### 1.2.7 Claude Code authentication facts relevant to BYO [VERIFIED]
https://code.claude.com/docs/en/authentication
- Account types: Pro/Max (claude.ai login), Team/Enterprise, Console (with or without API key; keyless Console sign-in needs v2.1.242+), cloud providers (Bedrock, Google Cloud Agent Platform, Foundry), cloud gateway.
- **Precedence:**
  1. Cloud provider env (`CLAUDE_CODE_USE_BEDROCK|VERTEX|FOUNDRY`)
  2. `ANTHROPIC_AUTH_TOKEN`
  3. `ANTHROPIC_API_KEY`
  4. `apiKeyHelper`
  5. `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, a one-year token that "can only make model requests")
  6. Anthropic profiles / federation
  7. Subscription OAuth from `/login`
- Credential storage: macOS Keychain (fallback `~/.claude/.credentials.json`, mode 0600), Linux `~/.claude/.credentials.json`, Windows `%USERPROFILE%\.claude\.credentials.json`.
- "Claude Desktop and cloud sessions do not call `apiKeyHelper` or read these environment variables: they use OAuth."
- `--bare` mode "never reads OAuth credentials or the system keychain" and needs `ANTHROPIC_API_KEY` or `apiKeyHelper`. Bare mode "will become the default for `-p` in a future release." **[VERIFIED]** https://code.claude.com/docs/en/headless. **Implication:** once bare becomes the default for `-p`, headless delegation will need an API key unless the caller passes non-bare flags. **[INFERRED]**

### 1.3 claude.ai web: remote MCP custom connectors [VERIFIED]
https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp (updated 2026-08-11)
- "Custom connectors using remote MCP are available on Claude, Cowork, and Claude Desktop for users on Free, Pro, Max, Team, and Enterprise plans. **Free users are limited to one custom connector.**"
- Individuals add them under **Customize > Connectors** > "+" > "Add custom connector" > URL. Advanced settings take an OAuth Client ID/Secret. Team/Enterprise owners use Organization settings > Connectors.
- "your MCP server must be reachable over the public internet from Anthropic's IP ranges." Private servers need firewall allowlisting of Anthropic IPs.
- Supports tools, "interactive connectors (inline cards and fullscreen views)" (i.e. MCP Apps), research integration, and mobile use after configuration.
- **DOCS-DRIFT FLAG:** the MCP Apps build guide (https://modelcontextprotocol.io/extensions/apps/build) says "Custom connectors are available on paid Claude plans (Pro, Max, or Team)". The Aug 2026 support article allows one on Free.
- **Local dev pattern (from the MCP Apps build guide):** `npx cloudflared tunnel --url http://localhost:3001`, then add the https URL as a custom connector. **[VERIFIED]** For a desktop app with a live document this is fragile and a security risk: it exposes the document to the internet. **[INFERRED]**

### 1.4 Other bridges
- **`mcp-remote`** (npm 0.14.2, 2026-09-13): a stdio-to-remote proxy with OAuth. Flags: `--header`, `--transport http-first|sse-first|http-only|sse-only`, `--allow-http` (trusted private networks), `--host`, callback port. `--protocol auto` gives dual-era compatibility with 2026-07-28 servers. **[VERIFIED]** https://github.com/geelen/mcp-remote
- **MCP Inspector** (npm 2.7.0): `npx @modelcontextprotocol/inspector <command>` for testing. **[VERIFIED npm]**
- **MCP Registry** (preview): `server.json` metadata, reverse-DNS namespaces (`io.github.user/server`), meant for aggregators rather than hosts. It supports npm/PyPI/MCPB packages and remotes. **[VERIFIED]** https://modelcontextprotocol.io/registry/about

---

## 2. Policy: subscription/OAuth use by third-party products

### 2.1 Exact current wording (primary sources)

**A. Claude Code "Legal and compliance" > Authentication and credential use** [VERIFIED verbatim] https://code.claude.com/docs/en/legal-and-compliance

> Claude Code authenticates with Anthropic's servers using OAuth tokens or API keys. These authentication methods serve different purposes:
>
> * **OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications. ...
> * **Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. **Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.**
>
> This does not restrict how customers provision and manage their own API keys or third-party inference provider credentials ... provided the resulting usage is billed to the key owner ... and is not resold or intermediated as described above. **Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code** as described under *Can customers offer Claude Code in their products?* above.
>
> Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.

Same page, **"Can customers offer Claude Code in their products?"** [VERIFIED verbatim]:

> Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service and complying with the conditions below:
> * **The Claude Code binary must not be modified.** Claude Code must be installed and run as published by Anthropic, and customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key).
> * **Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.** Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential (Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry). That usage is billed directly to the end user under their own agreement with Anthropic or, for third-party inference providers, with the applicable provider.

Naming:

> You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product.

Acceptable use:

> Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK.

**B. Agent SDK overview and quickstart** [VERIFIED verbatim] https://code.claude.com/docs/en/agent-sdk/overview, https://code.claude.com/docs/en/agent-sdk/quickstart

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead.

Branding guidelines (overview):
- **Allowed:** "Claude Agent" (preferred for dropdown menus); "Claude" (when within a menu already labeled "Agents"); "{YourAgentName} Powered by Claude".
- **Not permitted:** "Claude Code" or "Claude Code Agent"; Claude Code-branded ASCII art or visual elements that mimic Claude Code.
- "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service."
- The SDK auth env vars: `ANTHROPIC_API_KEY`; `CLAUDE_CODE_USE_BEDROCK=1`; `CLAUDE_CODE_USE_ANTHROPIC_AWS=1` + `ANTHROPIC_AWS_WORKSPACE_ID`; `CLAUDE_CODE_USE_VERTEX=1`; `CLAUDE_CODE_USE_FOUNDRY=1`. Packages: `@anthropic-ai/claude-agent-sdk` (npm latest 0.3.273, 2026-09-15) and `claude-agent-sdk` (PyPI). Both bundle a native Claude Code binary.

**C. Support: "Logging in to your Claude account"** (updated 2026-05-19) [VERIFIED quotes via fetch] https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account

> "The preferred way to access Anthropic services using third-party software, tools, or services is through API key authentication through Claude Console or a supported cloud provider."
> "Anthropic may at its discretion allow paid subscribers who have enabled usage credits to use certain third-party tools to access Anthropic services included in paid subscription plans."
> "Use of third-party tools that misrepresent their identity to Anthropic's servers, attempt to route third-party traffic against subscription limits, or otherwise violate applicable terms or policies is prohibited."

**D. Support: "Use the Claude Agent SDK with your Claude plan"** (updated 2026-06-16) [VERIFIED quotes via fetch] https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan

> "**Update June 15:** We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits."
>
> "The Agent SDK monthly credit applies to: Claude Agent SDK usage in your own projects (Python or TypeScript) the `claude -p` command in Claude Code (non-interactive mode) the Claude Code GitHub Actions integration Third-party apps that authenticate with your Claude subscription through the Agent SDK"

The (paused) credit table: Pro $20, Max 5x $100, Max 20x $200, Team Standard $20, Team Premium $100, Enterprise usage-based $20, Enterprise seat-based Premium $200.

**E. Consumer Terms** (effective 2025-10-08) [VERIFIED via fetch] https://www.anthropic.com/legal/consumer-terms

> Prohibited: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."
> "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else."

### 2.2 Timeline (2026)
- **~2026-01-09:** server-side checks begin rejecting subscription OAuth tokens used by third-party tools such as OpenCode. Reported error: `"This credential is only authorized for use with Claude Code and cannot be used for other API requests."` **[VERIFIED-2nd]** https://www.zbuild.io/resources/news/opencode-blocked-anthropic-2026, https://abit.ee/en/artificial-intelligence/anthropic-claude-code-oauth-openclaw-opencode-claude-max-subscription-api-ban-terms-of-service-en
- **2026-04-04:** "Claude subscriptions will no longer cover usage through third-party tools", starting with OpenClaw and applying to "all third-party harnesses." Users need extra usage or an API key. A one-time credit equal to the monthly plan price was given. **[VERIFIED-2nd]** https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/, https://venturebeat.com/technology/anthropic-cuts-off-the-ability-to-use-claude-subscriptions-with-openclaw-and
- **2026-05-13:** reported reinstatement of third-party agent usage via a separate monthly **Agent SDK credit**, effective 2026-06-15. **[VERIFIED-2nd]** https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch
- **2026-06-15:** Anthropic **paused** the Agent SDK credit change. "Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits." **[VERIFIED]** (support article D)
- **Current state (Sept 2026):** the legal page (A) still says third-party developers may not offer Claude.ai login or route requests through Free, Pro or Max plan credentials on behalf of their users, with no exception in that paragraph, and the Agent SDK note (B) says they may not offer claude.ai login "unless previously approved". **[VERIFIED]**

**POLICY-DRIFT FLAG:** support article D lists "Third-party apps that authenticate with your Claude subscription through the Agent SDK" as a recognized category. Doc B says third-party developers may not offer claude.ai login "unless previously approved." Doc A's authentication paragraph says the same of Claude.ai login, and also bars routing requests through plan credentials on users' behalf, with no approval exception (A's "Unless we've mutually agreed otherwise" belongs to its section on running Claude Code in products). The reconciliation I'd assume: approved partners, or sign-in completing inside Anthropic's own flow in the unmodified binary, may be tolerated. Unapproved open-source apps should not rely on it. **[INFERRED; treat as an open question for Anthropic]**

### 2.3 What is allowed vs what requires API keys

| Scenario | Status | Basis |
|---|---|---|
| User installs our open-source app **and adds our MCP server to their own Claude Desktop / Claude Code / claude.ai**, signed in with their Pro/Max plan | **Allowed** (ordinary use of native Anthropic apps; MCP is a first-class feature of those apps) | A ("designed to support ordinary use of Claude Code and other native Anthropic applications"), plus 1.1–1.3 docs. Compliance conclusion is **[INFERRED]** but strongly supported. |
| Our app shows "Sign in with Claude / claude.ai" and calls the model with the resulting OAuth token | **Not allowed** | A, B **[VERIFIED]** |
| Our app reads `~/.claude/.credentials.json`, the macOS Keychain entry, or `CLAUDE_CODE_OAUTH_TOKEN` and uses it | **Not allowed** ("may not collect, store, or intermediate Claude.ai credentials or session tokens"; "misrepresent their identity") | A, C **[VERIFIED]** |
| Our app embeds the Agent SDK with claude.ai login for end users | **Not allowed unless previously approved** | B **[VERIFIED]** |
| Our app runs the user's own installed Claude agent adapter (built on the Agent SDK) over ACP, signed in through Anthropic's own flow in the adapter's Claude Code, billed to the user's plan (what Sonobe built, section 2.6) | **Open question; ask Anthropic first.** D names third-party apps that authenticate with a subscription through the Agent SDK and says, "For now, nothing has changed", that their usage "still draw[s] from your subscription's usage limits". B says third-party developers may not offer claude.ai login "unless previously approved". A bars routing "requests through Free, Pro, or Max plan credentials on behalf of their users", with no exception. The app meets A's credential rule (it never collects, stores or intermediates credentials, and sign-in completes in Anthropic's own flow); A's bar on routing requests through plan credentials on users' behalf is the question to put to Anthropic. | D, A, B **[VERIFIED]**; the rating is **[INFERRED]**. Sonobe keeps it off by default and unreleased until Anthropic agrees; packaged builds hide the switch. |
| Our app embeds the Agent SDK / Anthropic SDK with **the user's own API key** (or Bedrock/Vertex/Foundry credential) | **Allowed**, billed to key owner | A, B **[VERIFIED]** |
| Our app spawns the **user's already-installed, unmodified `claude` binary** (`claude -p`) that uses the user's own login, as a background engine | **Gray zone.** A says users may sign in to the unmodified binary "including where a platform hosts Claude Code", but "preinstalling or running Claude Code in your products" requires Commercial Terms and no intermediation. C prohibits tools that "route third-party traffic against subscription limits". April 2026 enforcement targeted "third-party harnesses". | **[INFERRED]**. Get written confirmation before shipping as a default. |
| Button in our app: "Open this document in Claude Code", which opens the user's terminal with `claude` in the project dir (MCP pre-registered), and the user drives the session | **Very likely allowed** (the user is using the native app directly) | **[INFERRED]** |
| Marketing: "Works with Claude Desktop and Claude Code via MCP" | Allowed in plain text; don't use "Claude Code" in product/feature names or logos | A **[VERIFIED]** |
| An optional hosted relay so claude.ai web can reach a user's desktop | Allowed technically (a custom connector is a native feature). Security- and ops-heavy. | 1.3 **[VERIFIED capabilities]**; risk is **[INFERRED]** |

### 2.4 Recommended stance for our project [INFERRED]
- **Default integration = MCP server only.** Zero Anthropic credentials in our app.
- **Optional in-app assistant = BYO API key only** (plus Bedrock/Vertex/Foundry for enterprises), stored in the OS keychain.
- **No claude.ai login, no token reuse, no hidden headless harness on subscriptions.** Offer "Open in Claude Code / Claude Desktop" hand-offs instead.
- **Revised 2026-09-20:** the one exception is the experimental subscription option in section 2.6. The person turns it on, installs the adapter and signs in through Claude Code's own login, and Sonobe reads no credentials. It is off by default, labelled as awaiting Anthropic's permission, hidden in packaged builds, and not released until Anthropic agrees.
- Keep a watch on https://code.claude.com/docs/en/legal-and-compliance and support article 15036540. Policy moved four times in 2026.

### 2.5 Why headless delegation is risky even though it's technically easy [INFERRED]
- `claude -p ... --output-format stream-json --mcp-config ./origami.mcp.json` works with the user's saved login when not in `--bare` (https://code.claude.com/docs/en/headless). Anthropic says `--bare` "will become the default for `-p` in a future release", and bare never reads OAuth. Future Claude Code versions may therefore require an API key for this path by default.
- Enforcement targeted "third-party harnesses", and usage limits "assume ordinary, individual usage".
- A hidden engine may count as a harness; a user-launched session is ordinary use.

### 2.6 What Sonobe built: the Assistant on a Claude subscription (2026-09-20)

Sonobe's in-app Assistant can run on the person's own Claude subscription, experimentally. It's off by default, behind a switch in Settings → Claude described as "Experimental · awaiting Anthropic's permission". Packaged builds, which any release would be, hide the switch unless started with `SONOBE_CLAUDE_SUBSCRIPTION=1`, and no release will offer it until Anthropic agrees. The API key stays the default. ARCHITECTURE.md §10 is the contract; this is the summary.

- **Why now.** Support article D says: "For now, nothing has changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription's usage limits." B says third-party developers may not offer claude.ai login "unless previously approved". A says Anthropic "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users", with no exception in that paragraph. The question to put to Anthropic is whether this option routes requests through the person's plan credentials on their behalf. The project will ask before any release, and the option waits on the answer. **[VERIFIED quotes; INFERRED reading]**
- **How it works.** Sonobe is an ACP client, the pattern ACP editors such as Zed use. It runs Claude's agent adapter, `@agentclientprotocol/claude-agent-acp` (built on the Agent SDK), as a child process on Electron's own Node, and gives it Sonobe's tools through a per-chat loopback MCP endpoint with a bearer token. The adapter isn't bundled (about 270 MB, a Claude Code binary per platform); the person installs it with npm. Sessions start with `tools: []`, `settingSources: []`, `strictMcpConfig: true` and `persistSession: false`, and the adapter's environment has no `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, so the plan pays rather than a stray key. The bearer token sits in Claude Code's process arguments, so the endpoint runs only the tool calls the chat's ACP stream announced.
- **Credentials.** Sonobe never reads or stores Claude credentials. The adapter inherits Sonobe's environment minus `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, so a `CLAUDE_CODE_OAUTH_TOKEN` already set there reaches it, as it would reach any child process. The adapter's Claude Code signs in through Anthropic's own flow (Sign in opens Terminal running the adapter's `--cli auth login --claudeai`) and keeps the login where it always does. Sonobe reads only the status the adapter reports (kind, label, plan, email). This matches A's "sign-in to a Claude account must complete through Anthropic's own flow". It doesn't settle A's bar on routing requests through plan credentials on users' behalf, which is the question for Anthropic. **[INFERRED]**
- **What a probe of the real adapter showed** (adapter 0.79.0, Claude Code 2.1.274, outside the app). `initialize` answers in about 150 ms, then the adapter pushes `_auth/status_update` (`{ kind: "account", label: "Claude Max" }` when signed in, `{ kind: "none" }` when not, `{ kind: "api_key" }` when `ANTHROPIC_API_KEY` is set). Signed out, `session/new` still succeeds and `session/prompt` fails with `-32000` "Authentication required". Under a custom system prompt, Claude Code sends MCP server instructions as a system-reminder in the first user message, not in the system prompt, so Sonobe puts its tool guide in its own prompt and its endpoint sends no instructions (the guide would otherwise go twice). Claude Code doesn't forward a tool's input as it's written, so the canvas draws through `preview_design`. In Claude Code's default permission mode, tools left out of `allowedTools` make the adapter send `session/request_permission` before the call. The CLI also makes one small Haiku request per session, to name it. **[VERIFIED: probed 2026-09-20]**
- **Tests.** CI tests the option against a fake ACP agent (`apps/desktop/tests/fake-claude-agent.mjs`) and never needs a Claude account.
- **What the real app showed** (a real Claude Max login, 2026-09-20, adapter 0.79.0). The switch, sign-in status, live drawing through `preview_design`, the import, wiring and Stop worked. One problem: the adapter starts each session in the person's own Claude Code `permissions.defaultMode`, read from their settings even with `settingSources: []`, so with `auto` there a save ran without a question. Sonobe now puts every session in Claude Code's "default" mode, fails the reply if it can't, and asks the person itself before a save, open or create that Claude Code didn't ask about. **[VERIFIED: in the app; the fix is tested against the fake agent]**
- **What's left** (ROADMAP.md): Anthropic's permission, then deciding the default. The permission-mode fix was checked with a real Claude Max login on 2026-09-20: the session asked before saving although that Claude Code defaults to auto mode.

---

## 3. MCP specification: latest version and features relevant to us

### 3.1 Versions
- **Current: `2026-07-28`** (released 2026-07-28). **[VERIFIED]** https://modelcontextprotocol.io/specification/versioning, https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Previous revisions: `2025-11-25`, `2025-06-18`, `2025-03-26` (introduced Streamable HTTP), `2024-11-05` (HTTP+SSE). **[VERIFIED from changelog and transport pages]**
- Version identifiers are `YYYY-MM-DD` of the last backward-incompatible change. Revision states: Draft / Current / Final. Features can be marked Deprecated (minimum 12-month window; 90-day expedited exception). **[VERIFIED]**
- All Tier-1 SDKs (TypeScript, Python, Go, C#) support 2026-07-28; Rust is in beta. **[VERIFIED]** (blog)

### 3.2 2026-07-28 major changes (verbatim-condensed) [VERIFIED]
https://modelcontextprotocol.io/specification/2026-07-28/changelog
1. **Sessions removed.** No `Mcp-Session-Id`. List endpoints "no longer vary per-connection". Cross-call state uses explicit server-minted handles passed as tool arguments (SEP-2567).
2. **Stateless.** The `initialize`/`notifications/initialized` handshake is removed. Every request carries `_meta` keys `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`, and SHOULD carry `io.modelcontextprotocol/clientInfo`. Results SHOULD carry `io.modelcontextprotocol/serverInfo`. Mismatch returns `UnsupportedProtocolVersionError` (SEP-2575).
3. **`server/discover`** is mandatory on servers; clients may call it first or use it as a stdio compatibility probe.
4. The HTTP GET stream and `resources/subscribe`/`unsubscribe` are replaced by **`subscriptions/listen`**, a long-lived POST-response SSE stream. Clients opt in to `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions`. Notifications are tagged `io.modelcontextprotocol/subscriptionId`. `notifications/progress` and `notifications/message` still flow on the originating request's response stream.
5. **Removed:** `ping`, `logging/setLevel`, `notifications/roots/list_changed`. Log level is set per request via `_meta` `io.modelcontextprotocol/logLevel`.
6. **Tasks** moved out of core into the official extension `io.modelcontextprotocol/tasks`. It polls with `tasks/get`, adds `tasks/update`, removes `tasks/list`, and lets servers return tasks unsolicited (SEP-2663).
7. **MRTR (Multi Round-Trip Requests)** replaces server-initiated requests (`roots/list`, `sampling/createMessage`, `elicitation/create`). The server returns `InputRequiredResult` (`resultType: "input_required"`, `inputRequests`, `requestState`), and the client retries the original request with `inputResponses` (SEP-2322).
8. Every result carries **`resultType`** (`"complete"` | `"input_required"`, plus `"task"` from the extension). Clients treat an omitted value as `"complete"`.
9. **SSE resumability removed** (`Last-Event-ID`). A broken stream loses the request; the client re-issues it with a new id.

Minor changes:
- `extensions` field in client/server capabilities.
- OpenTelemetry `_meta` keys (`traceparent`, `tracestate`, `baggage`).
- Deterministic `tools/list` ordering (SHOULD).
- Required headers `Mcp-Method`, `Mcp-Name`; `x-mcp-header` param mirroring (SEP-2243).
- **Cacheable results:** `ttlMs` + `cacheScope` (`"public"|"private"`) on `tools/list`, `prompts/list`, `resources/list`, `resources/read`, `resources/templates/list` (SEP-2549).
- Resource-not-found code changed `-32002` → **`-32602`**.
- OAuth: `iss` validation (RFC 9207), `application_type` in DCR, credentials keyed by issuer.
- `inputSchema`/`outputSchema` accept any JSON Schema 2020-12 keywords; `structuredContent` can be any JSON value (SEP-2106).
- URL-mode elicitation `notifications/elicitation/complete` and `elicitationId` removed.
- Error-code ranges: `-32000..-32019` implementation-defined, `-32020..-32099` reserved. **HeaderMismatch `-32020`, MissingRequiredClientCapability `-32021`, UnsupportedProtocolVersion `-32022`.**

### 3.3 Deprecated registry [VERIFIED]
https://modelcontextprotocol.io/specification/2026-07-28/deprecated

| Feature | Deprecated in | Migration | Earliest removal |
|---|---|---|---|
| Roots | 2026-07-28 (SEP-2577) | Pass dirs/files via tool params, resource URIs, config | First revision on/after 2027-07-28 |
| **Sampling** | 2026-07-28 | "Integrate directly with LLM provider APIs" | same |
| Logging | 2026-07-28 | stderr (stdio) / OpenTelemetry | same |
| Dynamic Client Registration | 2026-07-28 (PR #2858) | Client ID Metadata Documents | same |
| `includeContext: "thisServer"/"allServers"` | 2025-11-25 | omit / `"none"` | follows Sampling |
| HTTP+SSE transport | 2025-03-26 | Streamable HTTP | 3 months after SEP-2596 Final |

**Implication:** don't design features that depend on MCP sampling, for example "our server asks Claude to generate patch code". Make Claude call our tools instead. **[INFERRED]**

### 3.4 Streamable HTTP transport (2026-07-28) [VERIFIED]
https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- A single MCP endpoint (e.g. `/mcp`) that accepts **POST**. Each JSON-RPC request is its own POST. `Accept` must list `application/json` and `text/event-stream`. The server replies with either one JSON object or a request-scoped SSE stream (notifications, then the final response). A notification POST gets `202 Accepted`.
- **Security (verbatim):**
  > 1. Servers **MUST** validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks. If the `Origin` header is present and invalid, servers **MUST** respond with HTTP 403 Forbidden. ...
  > 2. When running locally, servers **SHOULD** bind only to localhost (127.0.0.1) rather than all network interfaces (0.0.0.0).
  > 3. Servers **SHOULD** implement proper authentication for all connections.
  > Without these protections, attackers could use DNS rebinding to interact with local MCP servers from remote websites.
- **Required headers on every POST:** `MCP-Protocol-Version: 2026-07-28` (must match `_meta`), `Mcp-Method`, and `Mcp-Name` (for `tools/call`, `resources/read`, `prompts/get`). Values that aren't header-safe use the `=?base64?...?=` sentinel. Mismatch returns `400` + `-32020`.
- Unsupported version returns `400` + `UnsupportedProtocolVersionError` listing supported versions. An unknown method returns `404` + `-32601`.
- **Cancellation:** on HTTP, closing the SSE response stream = cancel. `notifications/cancelled` is stdio-only.
- Servers SHOULD send `X-Accel-Buffering: no` on SSE and keep-alive comment lines (`:\r\n`) on long listen streams.
- **Legacy traffic:** GET/DELETE get `405`; ignore `Mcp-Session-Id` and `Last-Event-ID`. Clients detect era by trying a modern request first and falling back to `initialize` on a non-modern 400.

### 3.5 Tools (2026-07-28) [VERIFIED]
https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- Capability: `{ "tools": { "listChanged": true } }`. The tool set MUST NOT vary per connection (it MAY vary by authorization).
- **Tool fields:**
  - `name`: SHOULD be 1–128 chars, case-sensitive, `A-Z a-z 0-9 _ - .`
  - `title` (display), `description`, `icons[]` (`src`, `mimeType`, `sizes`)
  - `inputSchema`: JSON Schema, default dialect 2020-12, MUST NOT be null. For no params: `{ "type": "object", "additionalProperties": false }` is recommended.
  - `outputSchema` (optional), `annotations` (optional), `_meta`
  - `x-mcp-header` on primitive properties
- **Tool annotations** (`ToolAnnotations`): `readOnlyHint?`, `destructiveHint?`, `idempotentHint?`, `openWorldHint?` (booleans). "clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers." **[VERIFIED fields]** Defaults from earlier spec revisions: `readOnlyHint=false`, `destructiveHint=true` (meaningful only when not read-only), `idempotentHint=false`, `openWorldHint=true`. The 2026-07-28 schema page fetch did not show defaults. **[INFERRED from 2025 revisions; re-verify]**
- **Result content types:**
  - `text`
  - **`image`** `{type:"image", data:<base64>, mimeType:"image/png", annotations:{audience:["user"], priority:0.9}}`
  - `audio`
  - **`resource_link`** `{type:"resource_link", uri, name, description, mimeType}` (not guaranteed to appear in `resources/list`)
  - embedded `resource` `{type:"resource", resource:{uri, mimeType, text|blob, annotations}}`
  - All support `annotations` (`audience`, `priority`, `lastModified`).
- **Structured output:** `structuredContent` (any JSON value). If `outputSchema` is present, servers MUST conform and clients SHOULD validate. For backward compatibility, SHOULD also return serialized JSON in a text block.
- **Errors:** protocol errors are JSON-RPC errors (unknown tool → `-32602`). Execution errors use `isError: true` with actionable text so the model can self-correct.
- **Stateful tools (non-normative):** return opaque handles (UUIDv4, bounded lifetime) and accept them as arguments. State retention in the description. Clear expiry errors.
- **`tools/call` may return `InputRequiredResult`** (MRTR) to request elicitation, then gets a retry with `inputResponses` + `requestState` and a new JSON-RPC id.
- **Security:** servers MUST validate inputs, implement access controls, rate limit, and sanitize outputs. Clients SHOULD confirm sensitive ops and show inputs before calling.

### 3.6 Elicitation (form + URL modes via MRTR) [VERIFIED]
https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- Client capability: `"elicitation": { "form": {}, "url": {} }`, sent in `_meta` on each request. An empty `{}` means form only.
- **Form mode:** `requestedSchema` is a **flat object with primitive properties**. Allowed:
  - `string` (`minLength`, `maxLength`, `format`: `email|uri|date|date-time`, `default`)
  - `number`/`integer` (`minimum`, `maximum`)
  - `boolean`
  - single-select enum (`enum`, or `oneOf` const+title)
  - multi-select array enum
- "Servers **MUST NOT** use form mode elicitation to request sensitive information such as passwords, API keys, access tokens, or payment credentials". Use URL mode for those.
- **URL mode:** `{mode:"url", url, message}`. The client MUST show the full URL, MUST get consent, MUST NOT pre-fetch, and must open it securely.
- Response actions: `accept` (with `content` for form), `decline`, `cancel`.
- **Use for us:** "Which of these 3 matching patches did you mean?", "Confirm deleting 14 patches?", "Choose export format". Keep schemas flat. **[INFERRED]**

### 3.7 Progress, cancellation, logging [VERIFIED]
- `notifications/progress` params: `progressToken`, `progress` (must increase), `total?`, `message?`. The token comes from the request `_meta.progressToken`. **[VERIFIED]** (schema page + SDK docs)
- On HTTP, progress flows on that request's SSE response stream (not the listen stream).
- Logging (`notifications/message`) is **deprecated**, and servers MUST NOT emit it unless the request `_meta` included `io.modelcontextprotocol/logLevel`.

### 3.8 MCP Apps extension (interactive UI in chat) [VERIFIED]
Sources: https://modelcontextprotocol.io/extensions/apps/overview, https://github.com/modelcontextprotocol/ext-apps (spec `specification/2026-01-26/apps.mdx`; draft at `specification/draft/apps.mdx`), https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- Launched **2026-01-26**. Extension id **`io.modelcontextprotocol/ui`**.
- **Hosts:** Claude (web), Claude Desktop, VS Code GitHub Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam, ChatGPT, Cursor, Archestra.AI, PostHog Code (client matrix). Claude Code is not listed.
- **Pattern:** a tool declares `_meta.ui.resourceUri: "ui://..."`, and the server serves that resource with MIME **`text/html;profile=mcp-app`** (`RESOURCE_MIME_TYPE`). The host may preload the UI before the call, fetches the resource, renders it in a **sandboxed iframe**, and pushes tool input/results.
- Tool `_meta.ui.visibility` defaults to `["model","app"]`. `"app"` = callable only from the app (from the same server).
- Resource `_meta.ui`:
  - `csp`: `connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains` (deny-by-default CSP)
  - `permissions`: camera, microphone, geolocation, clipboardWrite
  - `domain`: dedicated sandbox origin
  - `prefersBorder`
- **postMessage JSON-RPC:**
  - View → Host requests: `ui/initialize`, `ui/open-link`, `ui/message`, `ui/update-model-context`, `ui/request-display-mode`, `tools/call`, `resources/read`
  - Host → View notifications: `ui/notifications/initialized`, `ui/notifications/tool-input`, `ui/notifications/tool-input-partial`, `ui/notifications/tool-result`, `ui/notifications/tool-cancelled`, `ui/notifications/size-changed`, `ui/notifications/host-context-changed`, `ui/resource-teardown`
- Display modes: `inline` (default), `fullscreen`, `pip`. Host context: `theme` (light/dark), `displayMode`, `locale`, `timeZone`, `platform` (web/desktop/mobile), `containerDimensions`, CSS variables.
- Client capability: `"extensions": { "io.modelcontextprotocol/ui": { "mimeTypes": ["text/html;profile=mcp-app"] } }`
- **SDK:** `@modelcontextprotocol/ext-apps` (npm **2.0.0**, 2026-09-08), with subpaths `/react`, `/app-bridge`, `/server` (`registerAppTool`, `registerAppResource`, `RESOURCE_MIME_TYPE`). The README peer deps are `@modelcontextprotocol/client@^2.0.0`, `zod@^4.2.0`, Node 20+.
- UI side:
  ```ts
  import { App } from "@modelcontextprotocol/ext-apps";
  const app = new App({ name: "Get Time App", version: "1.0.0" });
  app.connect();
  app.ontoolresult = (result) => { /* render */ };
  const r = await app.callServerTool({ name: "get-time", arguments: {} });
  ```
  The build guide bundles to one HTML file with `vite-plugin-singlefile`.
- **DOCS-DRIFT FLAG:** the build guide's server example still uses v1 (`@modelcontextprotocol/sdk/server/mcp.js`, `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`). ext-apps 2.0.0 targets SDK v2 and the 2026-07-28 spec has no sessions. Follow the v2 SDK patterns and the ext-apps API docs (https://apps.extensions.modelcontextprotocol.io/api/).
- **Use for us:** a `preview_prototype` tool whose `ui://origami/preview.html` renders the prototype player (canvas/WebGL) inline in Claude Desktop/claude.ai. Users can tap through the interaction in-chat, and the app can call `set_patch_value` tools. **[INFERRED]**

### 3.9 Tasks extension (long-running ops) [VERIFIED]
https://modelcontextprotocol.io/seps/2663-tasks-extension (Final), reference https://github.com/modelcontextprotocol/ext-tasks
- Id `io.modelcontextprotocol/tasks`; the client declares it in per-request capabilities. The server decides per request whether to return `CreateTaskResult` with `resultType: "task"`.
- `Task` fields: `taskId`, `status` (`working|input_required|completed|cancelled|failed`), `statusMessage`, `createdAt`, `ttlMs` (nullable), `pollIntervalMs?`, plus `result`/`error`/`inputRequests` by status.
- Methods: `tasks/get` (poll), `tasks/update` (send `inputResponses`), `tasks/cancel` (cooperative). Optional `notifications/tasks` via subscriptions. `Mcp-Name` = `taskId` on HTTP.
- Example seed: `{"resultType":"task","taskId":"786512e2-...","status":"working","statusMessage":"The operation is now in progress.","ttlMs":60000,"pollIntervalMs":5000}`
- Client support: not in the extension matrix for any Claude surface. **[INFERRED: don't depend on it; use progress notifications + fast tools, or export jobs with handle + status tool]**
- SDK v2 note: legacy (2025) core task methods remain for 2025 peers but are rejected (`-32601`) on 2026-era connections. **[VERIFIED]** https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html

### 3.10 Other extensions (matrix) [VERIFIED]
`io.modelcontextprotocol/oauth-client-credentials`, `io.modelcontextprotocol/enterprise-managed-authorization`, `io.modelcontextprotocol/skills` (Skills over MCP; ChatGPT partial). https://modelcontextprotocol.io/extensions/client-matrix

### 3.11 Authorization basics [VERIFIED]
https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- "Authorization is **OPTIONAL** for MCP implementations."
- HTTP transports SHOULD conform (OAuth 2.1, RFC 9728 Protected Resource Metadata MUST, RFC 8707 resource indicators MUST, CIMD SHOULD, DCR deprecated, RFC 9207 `iss`).
- "Implementations using an STDIO transport **SHOULD NOT** follow this specification, and instead retrieve credentials from the environment."
- **Implication:** a localhost server doesn't need full OAuth. A static bearer token plus Origin/Host validation is consistent with the spec's local-server guidance (section 5). **[INFERRED + VERIFIED security page]**

---

## 4. TypeScript SDK (September 2026)

### 4.1 Packages and versions [VERIFIED]
npm registry query, 2026-09-16:

| Package | latest | published |
|---|---|---|
| `@modelcontextprotocol/server` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/client` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/node` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/express` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/hono` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/sdk` (v1) | 1.30.0 | 2026-07-27 |
| `@modelcontextprotocol/ext-apps` | 2.0.0 | 2026-09-08 |

Also listed in the docs: `@modelcontextprotocol/fastify`, `@modelcontextprotocol/server-legacy`, `@modelcontextprotocol/codemod`. https://ts.sdk.modelcontextprotocol.io/v2/

- "v2 is the stable release line"; "v1.x continues to receive bug fixes and security updates for at least 6 months after v2's release." https://github.com/modelcontextprotocol/typescript-sdk
- Schemas: **Standard Schema** ("Zod v4, Valibot, ArkType, or any compatible library"). Examples import `* as z from 'zod/v4'`, and `inputSchema: z.object({...})` (a z.object, not a raw shape). ESM only (`npm pkg set type=module`).
- Docs: https://ts.sdk.modelcontextprotocol.io/v2/ (v1 docs at https://ts.sdk.modelcontextprotocol.io/).

### 4.2 Core API surface [VERIFIED unless marked]
- `new McpServer({ name, version }, { capabilities?: {...} })`
- `server.registerTool(name, { title?, description, inputSchema?, outputSchema?, annotations?, _meta? }, async (args, ctx) => CallToolResult)`. The SDK validates args before calling the handler and converts the schema to JSON Schema.
- `server.registerResource(name, uriOrTemplate, { title?, description?, mimeType? }, async (uri, vars) => ({ contents: [{ uri: uri.href, text | blob, mimeType? }] }))`, with `new ResourceTemplate('teams://{teamId}/roster', { list: async () => ({ resources: [...] }) })`
- `server.sendResourceListChanged()`, `await server.sendResourceUpdated({ uri })`
- Handler context: `ctx.mcpReq._meta?.progressToken`, `await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken, progress, total, message } })`, `ctx.mcpReq.signal` (AbortSignal), `await ctx.mcpReq.log(level, msg)` (deprecated logging), `ctx.http.authInfo`.
- MRTR helper: handlers are "written once in the 2026 `inputRequired(...)` style and serve both eras". A legacy shim converts these to 2025 server→client requests. Options: `ServerOptions.inputRequired: { legacyShim: true (default), maxRounds (default 8), roundTimeoutMs }`. **[VERIFIED names; exact `inputRequired` signature not fetched]**
- **Stdio:** `import { serveStdio } from '@modelcontextprotocol/server/stdio'`, then `const handle = serveStdio(() => buildServer(), { legacy?: 'reject' })`. It negotiates era per connection and returns a `StdioServerHandle` with `close()`. The older `new StdioServerTransport()` + `server.connect(transport)` "serve only 2025 protocol". **Log to stderr only.**
- **HTTP:** `createMcpHandler(factory, { responseMode?: 'json'|'sse', legacy?: 'stateless'|'reject' })` builds a web-standard `fetch(Request) => Response`.
  - The factory receives `{ era, authInfo, requestInfo }` and returns a fresh `McpServer` per request.
  - Pass auth with `handler.fetch(request, { authInfo })`.
  - `handler.close()` shuts it down.
  - By default it serves both eras (`legacy: 'stateless'`).
- Node glue (`@modelcontextprotocol/node`): `toNodeHandler(handler)`, `localhostHostValidation()`, `localhostOriginValidation()`. Web-standard equivalents from `@modelcontextprotocol/server`: `hostHeaderValidationResponse`, `originValidationResponse`.
- "The handler performs no header validation. Mount protective middleware in front." Framework factories `createMcpExpressApp`, `createMcpHonoApp`, `createMcpFastifyApp` "arm both guards automatically on localhost binds".
- `createMcpExpressApp({ host?, allowedHosts?, allowedOrigins? })`: defaults to binding `127.0.0.1` and validating Host/Origin against `127.0.0.1`, `localhost`, `::1` (403 otherwise). Binding `0.0.0.0` requires `allowedHosts`.

### 4.3 Minimal example A: stdio server (verbatim from SDK docs) [VERIFIED]
```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

function createServer(): McpServer {
  const server = new McpServer({ name: 'weather', version: '1.0.0' });
  server.registerTool(
    'get-alerts',
    {
      description: 'Get the active weather alerts for a US state',
      inputSchema: z.object({ state: z.string().length(2).describe('Two-letter US state code, e.g. CA') })
    },
    async ({ state }) => ({ content: [{ type: 'text', text: `alerts for ${state}` }] })
  );
  return server;
}

void serveStdio(createServer);
console.error('weather MCP server running on stdio');
```
Install: `npm install @modelcontextprotocol/server zod tsx`. Test: `npx @modelcontextprotocol/inspector npx tsx src/index.ts`.

### 4.4 Minimal example B: live-document server over localhost HTTP (composed) [INFERRED composition of VERIFIED APIs]
The import location of `createMcpHandler` is assumed to be `@modelcontextprotocol/server`; verify against https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html.
```ts
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { doc } from './document-model.js'; // our app's live document (in-process)

const TOKEN = randomBytes(32).toString('base64url'); // write to ~/Library/Application Support/<App>/mcp.json (0600)

function buildServer(): McpServer {
  const server = new McpServer({ name: 'patchwork', version: '0.1.0' });

  server.registerTool('get_document', {
    title: 'Get document graph',
    description: 'Returns the open prototype: patches, ports, connections, layers. Read-only.',
    inputSchema: z.object({ documentId: z.string().optional() }),
    outputSchema: z.object({ documentId: z.string(), revision: z.number(), patches: z.array(z.any()) }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ documentId }) => {
    const snap = doc.snapshot(documentId);
    return { content: [{ type: 'text', text: JSON.stringify(snap) }], structuredContent: snap };
  });

  server.registerTool('add_patch', {
    title: 'Add patch',
    description: 'Adds a patch node. Pass baseRevision from get_document to avoid clobbering user edits.',
    inputSchema: z.object({ documentId: z.string(), baseRevision: z.number(), type: z.string(),
                            position: z.object({ x: z.number(), y: z.number() }).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (args) => {
    const r = doc.apply({ op: 'addPatch', ...args }); // grouped into an "AI edit" undo step
    if (!r.ok) return { isError: true, content: [{ type: 'text', text: r.error }] };
    return { content: [{ type: 'text', text: `Added ${r.patchId} (rev ${r.revision})` }],
             structuredContent: { patchId: r.patchId, revision: r.revision } };
  });

  server.registerTool('screenshot_preview', {
    title: 'Screenshot preview',
    description: 'Renders the prototype viewer at the current state and returns a PNG.',
    inputSchema: z.object({ documentId: z.string(), maxWidth: z.number().int().max(1600).default(800) }),
    annotations: { readOnlyHint: true }
  }, async ({ documentId, maxWidth }, ctx) => {
    const png = await doc.renderPng(documentId, { maxWidth, signal: ctx.mcpReq.signal });
    return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
  });

  return server;
}

const handler = createMcpHandler(() => buildServer());
const node = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

createServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;       // DNS-rebinding guard
  const auth = req.headers.authorization ?? '';
  const expected = `Bearer ${TOKEN}`;
  if (auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    res.writeHead(401).end(); return;
  }
  if (req.url?.split('?')[0] !== '/mcp') { res.writeHead(404).end(); return; }
  void node(req, res);
}).listen(47821, '127.0.0.1');
```

### 4.5 Minimal example C: v1 SDK (for reference / older hosts) [VERIFIED from MCP Apps build guide]
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// per request:
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
res.on("close", () => transport.close());
await server.connect(transport);
await transport.handleRequest(req, res, req.body);
```
**DOCS-DRIFT FLAG:** this is v1 and 2025-era. Prefer v2 (`createMcpHandler`).

---

## 5. Recommended architecture for a desktop app exposing a live document

### 5.1 Topology [INFERRED design]

```
┌───────────────────────── Our desktop app (Electron/Tauri/native) ─────────────────────────┐
│  Document model (CRDT/op log, undo groups, revision counter)                              │
│        ▲                                                                                  │
│        │ in-process calls                                                                 │
│  MCP server (SDK v2 createMcpHandler)                                                     │
│   ├─ Streamable HTTP on 127.0.0.1:<port>/mcp  (Host+Origin validation, Bearer token)      │
│   └─ IPC endpoint (Unix domain socket / Windows named pipe, 0600) for the shim            │
│  "AI activity" UI: connected clients, live tool-call log, pause/read-only toggle, undo    │
└───────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ HTTP (Claude Code direct)                ▲ IPC
        │                                          │
 Claude Code:  claude mcp add --transport http     │
   patchwork http://127.0.0.1:47821/mcp            │
   + headersHelper reading token file              │
                                                   │
                         patchwork-mcp (stdio shim, bundled binary or node script)
                           ├─ spawned by Claude Desktop via .mcpb Desktop Extension
                           ├─ spawned by Claude Code via plugin .mcp.json (alternative to HTTP)
                           └─ spawned by Cursor/VS Code/Goose/etc.
                         Behavior: serveStdio (dual-era) → forwards each request to app over IPC/HTTP;
                                   if app not running: launch it (or return a clear isError message)

 claude.ai web / mobile (optional, later): needs a public URL → opt-in relay or tunnel; off by default
```

### 5.2 Why HTTP in-app + a stdio shim [INFERRED]
- **Clients spawn stdio servers as child processes.** A live document lives in *our* already-running app, so the spawned process must connect back to the app. That's the shim.
- **Claude Code can connect over HTTP directly**, which avoids the shim and allows multiple concurrent clients. SDK v2's `createMcpHandler` is stateless, so each request gets a fresh `McpServer` bound to the same in-process document.
- **2026-07-28 statelessness makes the shim simple.** Each JSON-RPC request maps to one POST. Only `subscriptions/listen` needs a long-lived stream. For 2025-era clients (older Claude Desktop builds), the shim uses `serveStdio(factory)`, which negotiates era per connection. Its factory builds an `McpServer` whose handlers call into the app. The shim is then an *application-level* proxy rather than a byte proxy, so our app only needs to speak one internal RPC.
- **Alternative bridge:** `mcp-remote http://127.0.0.1:47821/mcp --allow-http --header "Authorization: Bearer ..." --protocol auto` in `claude_desktop_config.json`. That puts a token in a config file and adds an npx dependency, so a first-party shim is preferable.

### 5.3 Security for localhost servers
Normative guidance, **[VERIFIED]** https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices:
- DNS rebinding: "attacker accesses an insecure local server that's left running on localhost via DNS rebinding."
- "MCP servers intending for their servers to be run locally **SHOULD** implement measures to prevent unauthorized usage from malicious processes: Use the `stdio` transport to limit access to just the MCP client. Restrict access if using an HTTP transport, such as: Require an authorization token; Use unix domain sockets or other Interprocess Communication (IPC) mechanisms with restricted access."
- One-click install: "If an MCP client supports one-click local MCP server configuration, it **MUST** implement proper consent mechanisms prior to executing commands." That is the client's duty. We should still show exact commands in our "Connect to Claude" UI.
- State handles: "MCP servers **MUST NOT** treat possession of a state handle as authentication." Use non-deterministic handles.
- Token passthrough forbidden: "MCP servers **MUST NOT** accept any tokens that were not explicitly issued for the MCP server."
- Streamable HTTP: validate `Origin` (403 if invalid), bind 127.0.0.1, authenticate.

Our concrete checklist **[INFERRED]**:
1. **Bind `127.0.0.1` (and `::1`) only.** Never `0.0.0.0`.
2. **Validate `Host`** is `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` (`localhostHostValidation()`). This defeats DNS rebinding, because a rebinding page sends `Host: attacker.com`.
3. **Validate `Origin`.** Native MCP clients typically don't send it; browsers always do on cross-origin fetch. Reject any present Origin not on the allowlist (`localhostOriginValidation()`). Send **no CORS headers**.
4. **Bearer token.** 256-bit random, generated at first launch or per launch, written to `~/Library/Application Support/<App>/mcp-connection.json` (mode 0600) with `{port, token, pid, protocolVersions}`. The shim and Claude Code `headersHelper` read this file. Compare in constant time. Rotate on demand.
5. **Prefer IPC for the shim** (UDS 0600 / named pipe with ACL). HTTP stays optional and can be toggled off.
6. **Request hygiene.** Require `Content-Type: application/json`, cap body size (e.g. 5 MB), rate-limit per client, time out long calls, honor `ctx.mcpReq.signal`.
7. **Human in the loop inside our app.**
   - Visible "Claude connected" indicator and a live activity feed.
   - A global **read-only / pause AI edits** switch.
   - Every AI mutation is grouped into one undo step labeled with the client name.
   - Destructive tools (`delete_*`, `replace_document`) use `destructiveHint: true` and may require in-app confirmation or an MCP elicitation. Remember annotations are hints; Claude Desktop/Code prompt for approvals per their own policy.
8. **Optimistic concurrency.** Write tools take `baseRevision`. On conflict return `isError: true` with the current revision, so Claude re-reads instead of clobbering live user edits.
9. **Filesystem scope.** Export/import tools accept only paths under user-approved directories. No arbitrary shell or eval tool.
10. **Prompt-injection awareness.** Document text (layer names, notes) is untrusted data. Avoid tools that let document content trigger outbound network calls.
11. **Screenshots.** Downscale (e.g. ≤1600 px long edge) to stay under `MAX_MCP_OUTPUT_TOKENS` (25k default in Claude Code); offer `crop`/`scale` args. **[INFERRED sizes]**

### 5.4 Tool/resource/prompt surface for a patch-based prototyping tool [INFERRED]
- **Read (readOnlyHint):**
  - `list_documents`
  - `get_document` (structured graph + revision)
  - `get_patch`
  - `search_patch_library` (patch types, ports, param types/defaults)
  - `get_selection`
  - `get_preview_state` (current values of outputs)
  - `screenshot_preview` (image)
  - `screenshot_canvas` (image of the patch graph)
  - `validate_document` (type errors, disconnected ports)
- **Write:**
  - `add_patch`, `connect_ports`, `disconnect_ports`, `set_port_value`
  - `create_layer`, `set_layer_property`
  - `group_patches` (macro/component)
  - `apply_ops` (a batch of ops, atomic, returns new revision; reduces round trips)
- **Destructive:** `delete_patches`, `replace_document` (require confirmation).
- **Simulation:** `simulate_interaction` (tap/drag/scroll at a point, advance time, return frames or values). This is key for Claude verifying its own work.
- **Resources:**
  - `patchwork://documents/{id}/graph` (JSON; `resource_link` returned from tools)
  - `patchwork://library/patches/{type}` (docs per patch type)
  - `patchwork://documents/{id}/preview.png`
  - Resource updates via `subscriptions/listen` `resourceSubscriptions` on 2026 clients, `sendResourceUpdated` on 2025.
- **Prompts** (become slash commands in Claude Code): `/explain-prototype`, `/build-interaction` (args: description), `/audit-accessibility`.
- **MCP App:** `open_preview` tool with `_meta.ui.resourceUri = "ui://patchwork/player.html"`. A self-contained player renders inline in Claude Desktop/claude.ai. The player calls app-visible tools (`visibility: ["app"]`) such as `get_preview_state`/`simulate_interaction`.
- Naming: short snake_case. Avoid dots in tool names; Anthropic API custom tool names historically match `^[a-zA-Z0-9_-]{1,64}$`, and Claude Code prefixes `mcp__<server>__`. **[INFERRED; verify]**
- Always return `structuredContent` + `outputSchema` for graph data, and a concise text summary for models/clients that ignore structured content.
- Deterministic `tools/list` ordering (SHOULD). Set `ttlMs`/`cacheScope: "private"` on list results for 2026 clients (the SDK likely handles this; verify). **[VERIFIED requirement; SDK handling INFERRED]**

### 5.5 Distribution bundle [INFERRED plan on VERIFIED mechanisms]
1. **In-app "Connect to Claude" panel:**
   - Claude Desktop: a button downloads/opens `patchwork.mcpb`, and the Desktop install dialog appears.
   - Claude Code: shows a copyable `claude mcp add --transport http patchwork http://127.0.0.1:47821/mcp --scope user` plus the `headersHelper` note, or `/plugin marketplace add <our-org>/patchwork-claude` → `/plugin install patchwork@patchwork-claude`.
   - Others: generic JSON for `mcpServers` `{ command: "<app>/Contents/Resources/patchwork-mcp" }`.
   - Always show exactly what will run.
2. **`.mcpb`:** `server.type: "binary"` (per-platform shim) or `"node"` (Claude ships Node). `user_config` has an optional `document_dir` (`type: "directory"`). Declare the `tools` list for the directory listing.
3. **Claude Code plugin:** `.mcp.json` (stdio shim via `${CLAUDE_PLUGIN_ROOT}` or HTTP with `headersHelper`), plus `skills/patch-authoring/SKILL.md` teaching Claude our patch vocabulary, workflows (read graph → apply_ops → screenshot → verify), and design heuristics.
4. **Registry:** publish `server.json` to the MCP Registry (preview) under `io.github.<org>/patchwork`.
5. **claude.ai web:** off by default. Later, an opt-in relay (the app keeps an outbound WebSocket to our relay; the relay exposes a per-user https MCP endpoint with OAuth 2.1 + CIMD) if demand justifies it.

---

## 6. Optional in-app chat

### 6.1 Current model IDs and pricing [VERIFIED]
https://platform.claude.com/docs/en/about-claude/models/overview

| Model | API ID | Alias | Price in/out per MTok | Context | Max out | Thinking | Retirement (not sooner than) |
|---|---|---|---|---|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | same | $10 / $50 | 1M | 128K | Adaptive (always on) | 2027-09-01 |
| **Claude Opus 5** | **`claude-opus-5`** | same | $5 / $25 | 1M | 128K | Adaptive, default effort `high` | 2027-07-24 |
| **Claude Sonnet 5** | **`claude-sonnet-5`** | same | $2 / $10 | 1M | 128K | Adaptive, default effort `high` | 2027-06-30 |
| **Claude Haiku 4.5** | **`claude-haiku-4-5-20251001`** | `claude-haiku-4-5` | $1 / $5 | 200K | 64K | Extended | **2026-10-15** |

- Docs: "start with Claude Opus 5 for most workloads". Fable 5.1 is for "demanding reasoning and long-horizon agentic work". All current models support vision and tool use.
- **FLAG:** Haiku 4.5's retirement commitment is only "not sooner than October 15, 2026", about one month from today. Don't hard-code it. Make the model configurable and fetch capabilities from the Models API (`max_input_tokens`, `max_tokens`, `capabilities`). **[VERIFIED date; recommendation INFERRED]**
- "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6 generation on."
- Batch is 50% off; cache reads cost 10% of base input (2.5% on Fable 5.1).

### 6.2 Option A: BYO Anthropic API key + `@anthropic-ai/sdk` (recommended for in-app chat)
- `@anthropic-ai/sdk` npm latest **0.126.0** (2026-09-15). **[VERIFIED npm]**
- **Client-side MCP helpers** (reuse our MCP server as the tool surface): `import { mcpTools, mcpMessages, mcpResourceToContent, mcpResourceToFile } from "@anthropic-ai/sdk/helpers/beta/mcp"`, then `anthropic.beta.messages.toolRunner({ model, max_tokens, messages, tools: mcpTools(tools, mcpClient) })`. **[VERIFIED]** https://platform.claude.com/docs/en/agents-and-tools/mcp-connector. Unsupported values (including resource links) throw `UnsupportedMCPValueError`, so resolve resource links first.
  - The doc example still uses the v1 MCP client (`@modelcontextprotocol/sdk/client/index.js`) and notes a type-narrowing workaround ("The MCP SDK's callTool return type still includes a legacy result shape that mcpTools does not accept; narrow it."). **[VERIFIED]**
- **Server-side MCP connector** (`mcp_servers` + `mcp_toolset`, beta `mcp-client-2025-11-20`) needs a public https URL, supports tools only, and is not ZDR-eligible. **Not suitable for our localhost server.** **[VERIFIED]**
- Pros: clear policy; streaming, prompt caching and model choice under our control; works offline from Claude apps; supports enterprise Bedrock/Vertex/Foundry.
- Cons: users pay per token (not their subscription); we build chat UX.
- Implementation notes **[INFERRED]**:
  - Keep the key in the OS keychain (macOS Keychain / Windows Credential Manager / libsecret). Never log it.
  - Call the API directly from the desktop process (no proxy of ours), so usage is "billed to the key owner" and not intermediated.
  - Default to `claude-sonnet-5`, with a per-conversation switch to `claude-opus-5` for complex building and `claude-haiku-4-5` for quick explanations.
  - Use prompt caching for the patch-library system prompt.
  - Connect the in-app agent to our own MCP server through the SDK v2 client over IPC, so the in-app assistant, Claude Desktop and Claude Code share *one* tool surface and permission model.

### 6.3 Option B: Claude Agent SDK with API key
- `@anthropic-ai/claude-agent-sdk` (0.3.273) bundles the Claude Code binary and gives a full agent loop (hooks, subagents, permissions, sessions, skills, plugins).
  - `mcpServers` accepts stdio/http/sse/in-process SDK servers (`createSdkMcpServer`).
  - Tools must be allowed with `allowedTools: ["mcp__patchwork__*"]`. `acceptEdits` doesn't auto-approve MCP tools.
  **[VERIFIED]** https://code.claude.com/docs/en/agent-sdk/mcp
- Policy: API key auth for third-party products; claude.ai login not allowed unless previously approved. Branding: "Claude Agent" / "{Name} Powered by Claude", never "Claude Code". **[VERIFIED]**
- Pros: a stronger agent harness with less code. Cons: heavier (bundled binary per platform), still API-key billed, and its defaults load `.claude/` config from the cwd (be careful with trust).

### 6.4 Option C: delegate to user-installed Claude Code headless
- `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages --mcp-config <file> --allowedTools "mcp__patchwork__*" --permission-mode <mode>`
  - `--resume <session_id>` continues a session.
  - The `system/init` event reports `mcp_servers` status and `mcp_server_errors`.
  - `--permission-prompts none` for unattended runs (v2.1.259+).
  - `--json-schema` for structured output.
  **[VERIFIED]** https://code.claude.com/docs/en/headless
- Policy: gray zone for subscription auth (section 2.5). Low risk if the user sets `ANTHROPIC_API_KEY` for it.
- Technical risks: `--bare` is becoming the default for `-p` and won't read OAuth; version skew; the user must have Claude Code installed and logged in. **[VERIFIED bare note; risk INFERRED]**

### 6.5 What we should build [INFERRED recommendation]

**Phase 1 (MVP, highest leverage):**
- In-app MCP server (SDK v2, HTTP on 127.0.0.1 + IPC).
- `patchwork-mcp` stdio shim.
- `.mcpb` for Claude Desktop; Claude Code plugin with a skill; "Connect to Claude" panel with copyable commands.
- AI activity feed + read-only switch + undo grouping.
- Tools: read graph, apply ops (batched, revisioned), screenshot preview, simulate interaction, patch library docs.
- This gives Pro/Max users full "BYO subscription" with zero policy risk and no API cost to us.

**Phase 2:**
- MCP App player (`ui://`) for inline previews in Claude Desktop/claude.ai.
- Elicitation for disambiguation/confirmations.
- MCP Registry listing and directory submission.

**Phase 3 (optional):**
- In-app assistant panel with BYO API key (Anthropic, Bedrock, Vertex, Foundry) using `@anthropic-ai/sdk` + `mcpTools()` against the same MCP server.
- Configurable models; Sonnet 5 default.
- An "Open in Claude Code" button that launches the user's terminal/IDE with our plugin (the user drives the session).

**Built since, experimental (2026-09-20):**
- The in-app assistant on the user's Claude subscription, as an ACP client of the user-installed Claude agent adapter (section 2.6). Off by default, and not released until Anthropic agrees.

**Don't build:**
- "Sign in with Claude" in our app
- reading Claude Code credentials
- a background harness on subscription credentials (revised 2026-09-20: except the experimental option in section 2.6, which the person turns on and signs in to themselves, and which stays off and unreleased until Anthropic agrees)
- sampling-based features (deprecated)
- a hard dependency on Tasks or Channels (preview/limited client support)

---

## 7. Docs-vs-reality drift log (things to re-check)

| # | Topic | Stale/conflicting source | Current reality |
|---|---|---|---|
| 1 | Claude Desktop setup | modelcontextprotocol.io "Connect to local MCP servers" teaches hand-editing JSON | Support article (2026-06-30) presents Settings > Extensions / `.mcpb` as the intended path |
| 2 | MCP Apps server example | Build guide uses v1 `@modelcontextprotocol/sdk` + `StreamableHTTPServerTransport({sessionIdGenerator})` | ext-apps 2.0.0 peers on `@modelcontextprotocol/client@^2.0.0`; spec 2026-07-28 removed sessions |
| 3 | Custom connector plan limits | Build guide: "paid Claude plans (Pro, Max, or Team)" | Support (2026-08-11): Free/Pro/Max/Team/Enterprise; Free limited to one |
| 4 | Stdio in SDK v2 | README shows `StdioServerTransport` import | `StdioServerTransport` + `connect()` speaks only 2025 protocol; `serveStdio()` is dual-era |
| 5 | Sampling / Roots / Logging | Many tutorials still use them | Deprecated in 2026-07-28 (earliest removal ≥ 2027-07-28) |
| 6 | Server→client requests | 2025-era SSE push of `elicitation/create` | MRTR `InputRequiredResult` + retry; `notifications/elicitation/complete` removed |
| 7 | Tasks | 2025-11-25 experimental core tasks with blocking `tasks/result` | Extension `io.modelcontextprotocol/tasks`: `tasks/get` polling, `tasks/update`, no `tasks/list` |
| 8 | Resource subscriptions | `resources/subscribe` + GET SSE stream | `subscriptions/listen` POST stream |
| 9 | Resource-not-found error | `-32002` | `-32602` |
| 10 | OAuth registration | DCR | DCR deprecated → Client ID Metadata Documents; RFC 9207 `iss` |
| 11 | Agent SDK MCP OAuth link | links spec `2025-03-26` authorization | current is 2026-07-28 |
| 12 | Messages API MCP connector | only tools, public https, beta `mcp-client-2025-11-20` | unchanged; not for localhost |
| 13 | Subscription use by third parties | Support article D lists "Third-party apps that authenticate with your Claude subscription through the Agent SDK" | Legal page (A): third-party developers may not offer Claude.ai login or route requests through plan credentials on users' behalf, no exception given; Agent SDK docs (B): not permitted unless previously approved. D's changes paused 2026-06-15 ("For now, nothing has changed"), and D says such usage "still draw[s] from your subscription's usage limits". Sonobe's option (2.6) waits on Anthropic's answer |
| 14 | `claude -p` auth | Works with subscription login today | `--bare` (no OAuth) "will become the default for -p in a future release" |
| 15 | ToolAnnotations defaults | 2025 spec listed defaults | 2026-07-28 schema fetch didn't show defaults; re-verify |
| 16 | Haiku 4.5 | Widely recommended cheap model | Retirement commitment only not sooner than 2026-10-15 |

---

## 8. Source index
- Claude Code legal & compliance: https://code.claude.com/docs/en/legal-and-compliance
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code authentication: https://code.claude.com/docs/en/authentication
- Claude Code headless: https://code.claude.com/docs/en/headless
- Claude Code plugins: https://code.claude.com/docs/en/plugins
- Claude Code channels reference: https://code.claude.com/docs/en/channels-reference
- Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Agent SDK quickstart: https://code.claude.com/docs/en/agent-sdk/quickstart
- Agent SDK MCP: https://code.claude.com/docs/en/agent-sdk/mcp
- Models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- MCP connector + client helpers: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
- Support, custom connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Support, local MCP on Desktop: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- Support, desktop vs web connectors: https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors
- Support, logging in / third-party tools: https://support.claude.com/en/articles/13189465-logging-in-to-your-claude-account
- Support, Agent SDK with plan: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Consumer terms: https://www.anthropic.com/legal/consumer-terms
- MCP versioning: https://modelcontextprotocol.io/specification/versioning
- MCP 2026-07-28 changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- Deprecated registry: https://modelcontextprotocol.io/specification/2026-07-28/deprecated
- Streamable HTTP: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- Tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- MRTR: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
- Elicitation: https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- Authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- Schema: https://modelcontextprotocol.io/specification/2026-07-28/schema
- Security best practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- Spec release blog: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP Apps overview: https://modelcontextprotocol.io/extensions/apps/overview
- MCP Apps build: https://modelcontextprotocol.io/extensions/apps/build
- ext-apps repo/spec: https://github.com/modelcontextprotocol/ext-apps, https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- Extension client matrix: https://modelcontextprotocol.io/extensions/client-matrix
- Tasks SEP-2663: https://modelcontextprotocol.io/seps/2663-tasks-extension
- MCP Registry: https://modelcontextprotocol.io/registry/about
- Connect local servers tutorial: https://modelcontextprotocol.io/docs/develop/connect-local-servers
- TS SDK repo: https://github.com/modelcontextprotocol/typescript-sdk
- TS SDK v2 docs: https://ts.sdk.modelcontextprotocol.io/v2/ (first-server, serving/http, serving/express, serving/stdio, servers/tools, servers/resources, servers/logging-progress-cancellation, migration/support-2026-07-28)
- MCPB: https://github.com/modelcontextprotocol/mcpb, https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
- mcp-remote: https://github.com/geelen/mcp-remote
- Secondary (policy timeline): TechCrunch 2026-04-04, VentureBeat (April cut-off; May 13 reinstatement), zbuild.io, abit.ee
