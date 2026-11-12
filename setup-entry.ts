import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { tailstalkPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(tailstalkPlugin);
