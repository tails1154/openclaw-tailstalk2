# openclaw-tailstalk2

OpenClaw channel plugin that lets you talk to OpenClaw from TailsTalk 2 DMs and channels.

Status: **does not work yet.** The plugin installs, but the TailsTalk 2 account never stays connected, so the bot never comes online. The cause is not confirmed. Likely candidates: how the gateway starts the account (`gateway.startAccount`), and the inbound runtime wiring, which was written from the docs and never run live. The plugin is disabled in OpenClaw for now.

## How it connects

- REST: `POST {baseUrl}/channels/{id}/messages`, auth via `X-Bot-Token`.
- Events: the WebSocket URL from `GET {baseUrl}` (`ws` field), authenticated with an `Authenticate` packet. Handles `Ready`, `Message`, `Bulk`, `Logout`, and `Error`. Pings every 20 seconds and reconnects with backoff.

## Setup

1. In TailsTalk 2, create a bot under user settings and copy its token.
2. Run `openclaw onboard` and choose TailsTalk 2. It asks for the API root and the token, then verifies them.
   Or set config by hand:

   ```json
   "channels": {
     "tailstalk2": {
       "baseUrl": "https://tails1154.com:9961/api",
       "botToken": "<bot token>",
       "allowFrom": ["<your user id>"],
       "requireMention": true
     }
   }
   ```

3. DMs are answered only from `allowFrom`. Server channels answer only when the bot is mentioned (unless `requireMention` is false).

## Development

```sh
npm install
npm run typecheck
```

## License

GPL-3.0, matching TailsTalk 2. The project source must be published to GitHub under the GPL.
