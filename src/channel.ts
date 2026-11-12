import {
  createChatChannelPlugin,
  createChannelPluginBase,
} from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { TailsTalkClient, type TailsTalkChannel, type TailsTalkMessage } from "./client.js";
import { tailstalkSetupWizard } from "./setup.js";

export type TailsTalkAccount = {
  accountId: string | null;
  configured: boolean;
  enabled: boolean;
  baseUrl: string;
  botToken: string;
  allowFrom: string[];
  requireMention: boolean;
};

const CHANNEL = "tailstalk2";

function readSection(cfg: OpenClawConfig): Record<string, any> {
  return ((cfg.channels as Record<string, any>) ?? {})[CHANNEL] ?? {};
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): TailsTalkAccount {
  const s = readSection(cfg);
  const baseUrl = typeof s.baseUrl === "string" ? s.baseUrl.replace(/\/+$/, "") : "";
  const botToken = typeof s.botToken === "string" ? s.botToken : "";
  return {
    accountId: accountId ?? null,
    enabled: s.enabled !== false,
    configured: Boolean(baseUrl && botToken),
    baseUrl,
    botToken,
    allowFrom: Array.isArray(s.allowFrom) ? s.allowFrom.map(String) : [],
    requireMention: s.requireMention !== false,
  };
}

// Live state for the running account. Outbound sends reuse the started client.
let liveClient: TailsTalkClient | null = null;
let liveSelfId = "";
let liveChannels = new Map<string, TailsTalkChannel>();

export const tailstalkPlugin = createChatChannelPlugin<TailsTalkAccount>({
  base: createChannelPluginBase({
    id: CHANNEL,
    setupWizard: tailstalkSetupWizard,
    config: {
      listAccountIds: () => ["default"],
      resolveAccount,
      inspectAccount(cfg, accountId) {
        const a = resolveAccount(cfg, accountId);
        return {
          enabled: a.enabled,
          configured: a.configured,
          tokenStatus: a.botToken ? "available" : "missing",
        };
      },
    },
    setup: {
      applyAccountConfig: ({ cfg, input }) => ({
        ...cfg,
        channels: {
          ...cfg.channels,
          [CHANNEL]: { ...(cfg.channels as any)?.[CHANNEL], ...input },
        },
      }),
    },
  }),

  gateway: {
    apiVersion: 2,
    startAccount: async (ctx: any) => {
      const account: TailsTalkAccount = ctx.account;
      if (!account.configured) throw new Error("TailsTalk 2 needs baseUrl and botToken");
      const client = new TailsTalkClient(account.baseUrl, account.botToken);
      const self = await client.fetchSelf();
      const root = await client.fetchRoot();
      if (!root.ws) throw new Error("TailsTalk API root did not advertise a websocket URL");
      liveClient = client;
      liveSelfId = self._id;

      const log = (m: string) => (ctx.log?.info ? ctx.log.info(m) : console.log(m));
      await client.connectEvents({
        wsUrl: root.ws,
        signal: ctx.abortSignal,
        log,
        onReady: (selfId, channels) => {
          liveSelfId = selfId || self._id;
          liveChannels = new Map(channels.map((c) => [c._id, c]));
        },
        onMessage: (msg: TailsTalkMessage) => {
          void handleInbound(ctx, account, msg);
        },
      });
      liveClient = null;
    },
  },

  security: {
    dm: {
      channelKey: CHANNEL,
      resolvePolicy: () => "allowlist",
      resolveAllowFrom: (account: TailsTalkAccount) => account.allowFrom,
      defaultPolicy: "allowlist",
    },
  },

  threading: { topLevelReplyToMode: "reply" },

  outbound: {
    attachedResults: {
      channel: CHANNEL,
      sendText: async (params: { to: string; text: string; replyToId?: string }) => {
        if (!liveClient) throw new Error("TailsTalk 2 channel is not running");
        const sent = await liveClient.sendMessage(params.to, params.text, {
          replyToId: params.replyToId,
        });
        return { messageId: sent._id };
      },
    },
  },
} as any);

async function handleInbound(ctx: any, account: TailsTalkAccount, msg: TailsTalkMessage) {
  if (!msg.content || msg.author === liveSelfId) return;

  const channel = liveChannels.get(msg.channel);
  const isDm = channel?.channel_type === "DirectMessage";
  if (isDm) {
    if (!account.allowFrom.includes(msg.author)) return;
  } else {
    const mentioned = Boolean(
      liveSelfId && (msg.mentions?.includes(liveSelfId) || msg.content.includes(`<@${liveSelfId}>`)),
    );
    if (account.requireMention && !mentioned) return;
  }

  const runtime = ctx.runtime ?? ctx.channelRuntime;
  if (!runtime?.channel?.inbound?.run) {
    ctx.log?.warn?.("tailstalk2: plugin runtime inbound API unavailable; dropping message");
    return;
  }
  // Shared inbound pipeline. Replies return through outbound.sendText.
  await runtime.channel.inbound.run({
    channel: CHANNEL,
    accountId: account.accountId ?? "default",
    raw: msg,
    adapter: {
      ingest: (raw: TailsTalkMessage) => ({
        id: raw._id,
        conversationId: raw.channel,
        senderId: raw.author,
        text: raw.content ?? "",
        replyToId: raw.replies?.[0],
        isDirect: isDm,
      }),
      resolveTurn: () => ({ deliverTo: msg.channel, replyToId: msg._id }),
    },
  });
}

export { CHANNEL };
