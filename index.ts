import { Client, Events, GatewayIntentBits } from "discord.js";
import { token, membersToCheck, intervalMs } from "./configs/config.json";
import { ChannelTracker } from "./src/ChannelTracker";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const channelTracker = new ChannelTracker(client, membersToCheck, intervalMs);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[-] Bot is ready. Logged in as ${readyClient.user.tag}`);
  channelTracker.initialize();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  channelTracker.handleVoiceStateUpdateEvent({ oldState, newState });
});

client.login(token);
