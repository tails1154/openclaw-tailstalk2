// TailsTalk 2 API + Bonfire event client.
// Protocol reference: tailstalk2-backend/docs/docs/developers/{endpoints,events/*}.md
// Bot auth: X-Bot-Token header for REST; Authenticate packet for the socket.

export type TailsTalkMessage = {
  _id: string;
  channel: string;
  author: string;
  content?: string;
  replies?: string[];
  mentions?: string[];
};

export type TailsTalkChannel = {
  _id: string;
  channel_type: string;
  name?: string;
  recipients?: string[];
  server?: string;
};

export type ApiRoot = { ws?: string; features?: unknown };

type SocketOpts = {
  wsUrl: string;
  signal: AbortSignal;
  onReady: (self: string, channels: TailsTalkChannel[]) => void;
  onMessage: (msg: TailsTalkMessage) => void;
  log: (msg: string) => void;
};

export class TailsTalkClient {
  constructor(
    private readonly baseUrl: string,
    private readonly botToken: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      "X-Bot-Token": this.botToken,
      "Content-Type": "application/json",
    };
  }

  /** GET the API root; its `ws` field is the Bonfire events URL. */
  async fetchRoot(): Promise<ApiRoot> {
    const res = await fetch(this.baseUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`TailsTalk API root returned ${res.status}`);
    return (await res.json()) as ApiRoot;
  }

  /** Verifies the bot token and returns the bot's own user id. */
  async fetchSelf(): Promise<{ _id: string; username: string }> {
    const res = await fetch(`${this.baseUrl}/users/@me`, { headers: this.headers() });
    if (!res.ok) throw new Error(`TailsTalk token check failed: ${res.status}`);
    const bot = (await res.json()) as { _id: string; username?: string };
    return { _id: bot._id, username: bot.username ?? "" };
  }

  async sendMessage(
    channelId: string,
    content: string,
    opts: { replyToId?: string; idempotencyKey?: string } = {},
  ): Promise<TailsTalkMessage> {
    const body: Record<string, unknown> = { content };
    if (opts.replyToId) body.replies = [{ id: opts.replyToId, mention: false }];
    const headers = this.headers();
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const res = await fetch(`${this.baseUrl}/channels/${channelId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`TailsTalk send failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as TailsTalkMessage;
  }

  /** Opens a Bonfire socket and streams events until aborted, reconnecting with backoff. */
  async connectEvents(opts: SocketOpts): Promise<void> {
    let backoff = 1000;
    while (!opts.signal.aborted) {
      try {
        await this.runSocket(opts);
        backoff = 1000;
      } catch (err) {
        opts.log(`tailstalk2 socket error: ${(err as Error).message}`);
      }
      if (opts.signal.aborted) return;
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }

  private runSocket(opts: SocketOpts): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(opts.wsUrl);
      url.searchParams.set("version", "1");
      url.searchParams.set("format", "json");
      const ws = new WebSocket(url.toString());
      const channels: TailsTalkChannel[] = [];
      const pinger = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Ping", data: Date.now() }));
      }, 20_000);
      const onAbort = () => ws.close(1000, "shutdown");
      opts.signal.addEventListener("abort", onAbort, { once: true });
      const cleanup = () => {
        clearInterval(pinger);
        opts.signal.removeEventListener("abort", onAbort);
      };

      ws.onopen = () => ws.send(JSON.stringify({ type: "Authenticate", token: this.botToken }));
      ws.onerror = () => {
        cleanup();
        reject(new Error("socket error"));
      };
      ws.onclose = () => {
        cleanup();
        resolve();
      };
      ws.onmessage = (ev) => {
        const handle = (pkt: any) => {
          switch (pkt.type) {
            case "Bulk":
              for (const v of pkt.v ?? []) handle(v);
              break;
            case "Error":
              opts.log(`tailstalk2 event error: ${pkt.error}`);
              ws.close(4000, "error");
              break;
            case "Ready": {
              // Bots: the first user in Ready that is flagged as the bot is self.
              const self = pkt.users?.find((u: any) => u.bot)?._id ?? "";
              channels.splice(0, channels.length, ...(pkt.channels ?? []));
              opts.onReady(self, channels);
              break;
            }
            case "Logout":
              ws.close(1000, "logout");
              break;
            case "ChannelCreate":
              channels.push(pkt);
              break;
            case "Message":
              opts.onMessage(pkt as TailsTalkMessage);
              break;
          }
        };
        try {
          handle(JSON.parse(String(ev.data)));
        } catch (err) {
          opts.log(`tailstalk2 bad packet: ${(err as Error).message}`);
        }
      };
    });
  }
}
