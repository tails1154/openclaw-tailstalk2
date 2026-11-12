import type { ChannelSetupWizard } from "openclaw/plugin-sdk/channel-setup";

// Guided setup for `openclaw onboard`. Asks for the API root and a bot token,
// then writes channels.tailstalk2. The token is stored as a secret and is never
// echoed back in chat.
export const tailstalkSetupWizard: ChannelSetupWizard = {
  channel: "tailstalk2",
  status: {
    configuredLabel: "Connected",
    unconfiguredLabel: "Not configured",
    resolveConfigured: ({ cfg }: any) => {
      const s = ((cfg.channels as any) ?? {}).tailstalk2 ?? {};
      return Boolean(s.baseUrl && s.botToken);
    },
  },
  credentials: [
    {
      inputKey: "botToken",
      providerHint: "tailstalk2",
      credentialLabel: "TailsTalk 2 bot token",
      preferredEnvVar: "TAILSTALK2_BOT_TOKEN",
      envPrompt: "Use TAILSTALK2_BOT_TOKEN from the environment?",
      keepPrompt: "Keep the current bot token?",
      inputPrompt: "Create a bot in TailsTalk 2 (user settings, bots), then paste its token:",
      inspect: ({ cfg }: any) => {
        const token = ((cfg.channels as any) ?? {}).tailstalk2?.botToken;
        return { accountConfigured: Boolean(token), hasConfiguredValue: Boolean(token) };
      },
    },
  ],
  textInputs: [
    {
      inputKey: "baseUrl",
      message: "TailsTalk 2 API root (e.g. https://tails1154.com:9961/api):",
      placeholder: "https://tails1154.com:9961/api",
    },
  ] as any,
} as any;
