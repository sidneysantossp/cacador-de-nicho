# NexLev Intelligence Provider

The NexLev integration is operator-level intelligence, not a per-channel publishing credential.

## Authentication

The application uses the official NexLev OAuth 2.0 authorization server:

- issuer: `https://prod.dashboard.nexlev.io`
- authorization: `/api/mcp/oauth/authorize`
- token: `/api/mcp/oauth/token`
- dynamic client registration: `/api/mcp/oauth/register`
- MCP resource: `https://prod.dashboard.nexlev.io/api/codex-mcp`

The flow uses Authorization Code + PKCE (S256). No NexLev API key or OAuth client secret is exposed to the browser.

The account signed into during OAuth is the account whose NexLev plan and quotas apply. Operators should authenticate the paid account used by the business.

## Token storage

Access and refresh tokens are AES-256-GCM encrypted before database storage. `NEXLEV_TOKEN_ENCRYPTION_KEY` may be set independently. If omitted, the already-managed `YOUTUBE_TOKEN_ENCRYPTION_KEY` is used as the encryption root so the deployment does not require another bootstrap secret.

The browser receives only connection status, tool count, scopes and validation state. Tokens never return to the browser.

## MCP client

`src/lib/server/nexlev.ts` implements:

- dynamic OAuth client registration
- PKCE authorization URL/state
- authorization-code exchange
- refresh-token rotation
- `tools/list`
- generic `tools/call`

The generic MCP proxy is exposed only through the authenticated operator API. The agent operator may use `/api/nexlev-mcp` to research public YouTube intelligence after the human has completed OAuth.

## UI

Settings displays a dedicated **NexLev Intelligence** card with:

- Connect / reconnect
- Validate connection
- Disconnect
- discovered tool count

No API-key input is shown.

## Next layer

After OAuth is proven in production, NexLev tool outputs are normalized into Radar/Universe evidence:

1. Fresh Winners
2. newly-created long-form/faceless channels
3. small-channel viral outliers
4. similar channels/videos
5. transcripts and comments for shortlisted winners
6. Evidence Packs linked to Grug / Dino Knows
7. 15-video combined GRUG + Dino validation experiment tracking (see `docs/GRUG_DINO_15_VIDEO_VALIDATION_WORKFLOW.md`)
