import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { tailstalkPlugin } from "./src/channel.js";

export default defineChannelPluginEntry({
  id: "tailstalk2",
  name: "TailsTalk 2",
  description: "OpenClaw channel plugin for TailsTalk 2",
  plugin: tailstalkPlugin,
});
