import { type Client, type VoiceBasedChannel } from "discord.js";
import { VoiceState } from "discord.js";
import { TwitchApiClient } from "./TwitchApiClient";

type MemberInfo = {
  readonly discordUserId: string;
  readonly twitchUserId: string;
};

type VoiceStateUpdateEvent = {
  oldState: VoiceState;
  newState: VoiceState;
};

type ChannelInfo = {
  channel: VoiceBasedChannel;
  currentStatus: string;
  discordUserIds: string[];
};

enum MemberAction {
  JOINED_CHANNEL = "Joined",
  SWITCHED_CHANNELS = "Switched",
  REMAINED_IN_CHANNEL = "Remained",
  LEFT_CHANNEL = "Left",
}
/**
 * Tracks which channels have members that are currently live
 * streaming on twitch and marks their channel status accordingly.
 */
export class ChannelTracker {
  /**
   * The status to use for a channel that has a streamer
   * who is live.
   */
  private LIVE_STATUS = "🔴 Live";

  /**
   * The channel status to when no one is live in the channel.
   */
  private NOT_LIVE_STATUS = "";

  /**
   * Holds the {@link MemberInfo} for all streamers to
   * check the live status of.
   */
  memberInfo: MemberInfo[];

  /**
   * The discord bot client that is using this {@link ChannelTracker}.
   */
  client: Client;

  /**
   * An instance of {@link TwitchApiClient} that is used to ping twitch
   * for the live status of a streamer.
   */
  twitchConnector: TwitchApiClient;

  /**
   * The time interval in ms at which we check if a streamer in a channel
   * is live.
   */
  liveStatusCheckingInterval: number;

  /**
   * Holds the {@link NodeJS.Timeout} that triggers checking the live status
   * of all streamers in a channel.
   */
  liveStatusChecker: NodeJS.Timeout | undefined;

  /**
   * A cache for holding information regarding which which channels contain streamers.
   */
  channels = new Map<string, ChannelInfo>();

  /**
   * Constructs an instance of {@link ChannelTracker}.
   * @param client The client of the discord bot this {@link ChannelTracker} is used by.
   * @param memberInfo An array of {@link MemberInfo} informing this {@link ChannelTracker}
   * of which members stream and should be tracked.
   * @param liveStatusCheckingInterval The interval at which to check twitch to see if any
   * of the given members are live.
   */
  constructor(
    client: Client,
    memberInfo: MemberInfo[],
    liveStatusCheckingInterval: number,
  ) {
    this.client = client;
    this.memberInfo = memberInfo;
    this.twitchConnector = new TwitchApiClient();
    this.liveStatusCheckingInterval = liveStatusCheckingInterval;

    this.twitchConnector.initialize();
  }

  /**
   * Used for when the bot first starts and there could
   * be users already in channels that are live. This
   * will iterate through all guilds, all channels of
   * those guilds, all users in those channels of those
   * guilds that are live, and add them to the cache and
   * update the channel statuses accordingly.
   */
  public initialize() {
    console.log("[-] Initializing channel tracker...");

    const guilds = this.client.guilds.cache;

    guilds.forEach((guild) =>
      guild.channels.cache
        .filter((channel) => channel.isVoiceBased())
        .forEach((voiceBasedChannel) =>
          voiceBasedChannel.members
            .filter((member) => this.isStreamer(member.id))
            .forEach((liveMember) =>
              this.addMemberToChannel(voiceBasedChannel, liveMember.id),
            ),
        ),
    );

    console.log("[-] Finished initializing channel tracker...");

    this.printChannelCache();

    this.updateLiveStatusChecker();
  }

  /**
   * Starts the interval for checking if members in the voice channels are live
   * streaming or not and then updates the channel statuses accordingly.
   */
  private startLiveStatusChecker() {
    this.updateChannelStatuses();

    this.liveStatusChecker = setInterval(
      () => this.updateChannelStatuses(),
      this.liveStatusCheckingInterval,
    );
  }

  /**
   * Stops the scheduler for checking live statuses
   */
  private stopLiveStatusChecker() {
    clearInterval(this.liveStatusChecker);
    this.liveStatusChecker = undefined;
  }

  /**
   * Updates the cache to reflect any changes in members joining, switching,
   * or leaving voice channels. This will also restart the {@link liveStatusChecker}.
   * @param event
   * @returns
   */
  handleVoiceStateUpdateEvent(event: VoiceStateUpdateEvent): void {
    console.log("[-] Voice state update received...");

    const oldState = event.oldState;
    const newState = event.newState;

    // Do we have a user to begin with
    if (!oldState.member || !newState.member) {
      console.log(
        "[-] One of the voice states is missing the member information. Skipping...",
      );
      return;
    }

    const memberId = newState.member.id;

    // Is the member a streamer?
    if (!this.isStreamer(memberId)) {
      console.log(`[-] [${memberId}] is not a streamer. Skipping...`);
      return;
    }

    console.log(`[-] [${memberId}] is a streamer. Processing action...`);

    const memberAction = this.getMemberAction(event);

    console.log(`[-] Member performed [${memberAction}] action`);

    console.log("[-] Stopping live status checker...");
    this.stopLiveStatusChecker();

    switch (memberAction) {
      case MemberAction.JOINED_CHANNEL:
        this.handleJoinedChannelAction(event, memberId);
        break;

      case MemberAction.SWITCHED_CHANNELS:
        this.handleSwitchedChannelsAction(event, memberId);
        break;

      case MemberAction.LEFT_CHANNEL:
        this.handleLeftChannelAction(event, memberId);
        break;

      default:
        console.log(
          `[-] Action [${memberAction}] does not merit updating channel cache. Skipping...`,
        );
        return;
    }

    this.updateLiveStatusChecker();
  }

  /**
   * Handles the {@link JOINED_CHANNEL} action performed by the given user.
   * @param event The {@link VoiceStateUpdateEvent} for this {@link JOINED_CHANNEL} action.
   * @param memberId The member who performed {@link JOINED_CHANNEL}.
   */
  private handleJoinedChannelAction(
    event: VoiceStateUpdateEvent,
    memberId: string,
  ) {
    if (!event.newState.channel) {
      console.log("[-] Missing new state channel. Skipping...");
    } else {
      this.addMemberToChannel(event.newState.channel, memberId);
    }
  }

  /**
   * Handles the {@link SWITCHED_CHANNELS} action performed by the given user.
   * @param event The {@link VoiceStateUpdateEvent} for this {@link SWITCHED_CHANNELS} action.
   * @param memberId The member who performed {@link SWITCHED_CHANNELS}.
   */
  private handleSwitchedChannelsAction(
    event: VoiceStateUpdateEvent,
    memberId: string,
  ) {
    const newState = event.newState;
    const oldState = event.oldState;

    if (!oldState.channel || !newState.channel) {
      console.log("[-] Missing old or new state channel. Skipping...");
    } else {
      this.switchMemberToChannel(oldState.channel, newState.channel, memberId);
    }
  }

  /**
   * Handles the {@link LEFT_CHANNEL} action performed by the given user.
   * @param event The {@link VoiceStateUpdateEvent} for this {@link LEFT_CHANNEL} action.
   * @param memberId The member who performed {@link LEFT_CHANNEL}.
   */
  private handleLeftChannelAction(
    event: VoiceStateUpdateEvent,
    memberId: string,
  ) {
    if (!event.oldState.channel) {
      console.log("[-] Missing old state channel. Skipping...");
    } else {
      this.removeMemberFromChannel(event.oldState.channel, memberId);
    }
  }

  /**
   * Checks if the {@link liveStatusChecker} should be running or not.
   */
  private updateLiveStatusChecker() {
    if (this.streamerIsPresent()) {
      if (this.liveStatusChecker == undefined) {
        console.log("[-] Starting live status checker...");
        this.startLiveStatusChecker();
      }
    } else {
      console.log("[-] Stopping live status checker...");
      this.stopLiveStatusChecker();
    }
  }

  /**
   * @returns true is returned if a streamer is currently in a channel.
   */
  private streamerIsPresent(): boolean {
    return this.channels.size > 0;
  }

  /**
   * Checks the memberInfo array to see if any users with the given discordUserId stream.
   *
   * @param discordUserId The we are checking for discordUserId.
   * @returns true is returned if a member is found with the given discordUserId that streams.
   */
  private isStreamer(discordUserId: string): boolean {
    return this.memberInfo.some((m) => m.discordUserId === discordUserId);
  }

  /**
   * Uses the old and new voice state to determine if a user joined, switched, remained in, or left a channel.
   * @param event The VoiceStateUpdateEvent that is to be evaluated.
   * @returns The MemberAction corresponding to what actiont the member took is returned.
   */
  private getMemberAction(event: VoiceStateUpdateEvent): MemberAction {
    const oldState = event.oldState;
    const newState = event.newState;

    if (!oldState.channelId && !newState.channelId) {
      return MemberAction.LEFT_CHANNEL;
    } else if (oldState.channelId && !newState.channelId) {
      return MemberAction.LEFT_CHANNEL;
    } else if (!oldState.channelId && newState.channelId) {
      return MemberAction.JOINED_CHANNEL;
    } else {
      if (oldState.channelId === newState.channelId) {
        return MemberAction.REMAINED_IN_CHANNEL;
      } else {
        return MemberAction.SWITCHED_CHANNELS;
      }
    }
  }

  /**
   * Adds a member to a channel in the cache.
   * @param channel The channel to add the member to.
   * @param discordUserId The Discord user ID of the member being added.
   */
  private addMemberToChannel(
    channel: VoiceBasedChannel,
    discordUserId: string,
  ) {
    const currentValue = this.channels.get(channel.id);

    if (currentValue != null) {
      currentValue.discordUserIds.push(discordUserId);
    } else {
      this.channels.set(channel.id, {
        channel: channel,
        currentStatus: "",
        discordUserIds: [discordUserId],
      });
    }
  }

  /**
   * Removes the given member from a channel in the cache and removes
   * the channel from the cache if no more streamers are in
   * that chanel.
   * @param channel The channel the user is to be removed from
   * @param discordUserId The Discord user ID of the member
   * who is being removed.
   */
  private removeMemberFromChannel(
    channel: VoiceBasedChannel,
    discordUserId: string,
  ) {
    // Get the channel information for the given channel
    const currentValue = this.channels.get(channel.id);

    // Do we have channel information?
    if (currentValue != null) {
      currentValue.discordUserIds = currentValue.discordUserIds.filter(
        (userId) => userId !== discordUserId,
      );

      // Is there still at least one user in the given channel
      // after removing the given user?
      if (currentValue.discordUserIds.length < 1) {
        // Clearing channel status
        this.clearChannelStatus(channel);

        // Removing channel from cache
        this.channels.delete(channel.id);
      }
    }
  }

  /**
   * Moves a member from one channel to another in the cache.
   * This is to reflect the user switching channels on the server.
   * @param oldChannel The channel the member moved from.
   * @param newChannel The channel the member moved to.
   * @param discordUserId The Discord user ID of the member who moved.
   */
  private switchMemberToChannel(
    oldChannel: VoiceBasedChannel,
    newChannel: VoiceBasedChannel,
    discordUserId: string,
  ) {
    this.addMemberToChannel(newChannel, discordUserId);

    this.removeMemberFromChannel(oldChannel, discordUserId);
  }

  /**
   * Updates channel statuses to reflect any members that may be live streaming.
   */
  private async updateChannelStatuses() {
    console.log("[-] Checking if channel status needs updating...");
    for (const channelInfo of this.channels.values()) {
      for (const discordUserId of channelInfo.discordUserIds) {
        if (await this.isLive(discordUserId)) {
          if (channelInfo.currentStatus == this.LIVE_STATUS) {
            console.log("[-] Channel already has this status. Skipping...");
            continue;
          }
          this.setChannelStatus(channelInfo.channel);
        } else {
          if (channelInfo.currentStatus == this.NOT_LIVE_STATUS) {
            console.log("[-] Channel already has this status. Skipping...");
            continue;
          }
          this.clearChannelStatus(channelInfo.channel);
        }
      }
    }

    this.printChannelCache();
  }

  /**
   * Set's the channel status of the given {@link VoiceBasedChannel}
   * to "🔴 Live".
   * @param voiceBasedChannel The {@link VoiceBasedChannel} whose
   * channel status we are setting.
   */
  private async setChannelStatus(voiceBasedChannel: VoiceBasedChannel) {
    console.log("[-] Setting channel status...");
    await this.client.rest.put(
      `/channels/${voiceBasedChannel.id}/voice-status`,
      {
        body: {
          status: this.LIVE_STATUS,
        },
      },
    );
  }

  /**
   * Clears the channel status of the given {@link VoiceBasedChannel}.
   * @param voiceBasedChannel The {@link VoiceBasedChannel} whose
   * status we are clearing.
   */
  private async clearChannelStatus(voiceBasedChannel: VoiceBasedChannel) {
    console.log("[-] Clearing channel status...");
    await this.client.rest.put(
      `/channels/${voiceBasedChannel.id}/voice-status`,
      {
        body: {
          status: this.NOT_LIVE_STATUS,
        },
      },
    );
  }

  /**
   * Uses the {@link TwitchApiClient} to check if the given discord
   * member is live on twitch.
   * @param discordUserId The discord user ID of the member whose
   * live streaming status we are checking.
   * @returns true is returned if the member is live, otherwise
   * false is returned.
   */
  private async isLive(discordUserId: string): Promise<boolean> {
    console.log("[-] Checking if member is live on twitch...");
    const memberInfo = this.memberInfo.find(
      (m) => m.discordUserId === discordUserId,
    );

    if (!memberInfo) {
      console.log("[-] Member is not a known live streamer...");
      return false;
    }

    try {
      return await this.twitchConnector.isLive(memberInfo.twitchUserId);
    } catch (error) {
      console.log(
        `[-] Something went wrong when checking if this member was live... | ${error}`,
      );
      return false;
    }
  }

  /**
   * Prints out the channel cache in formatted human readable way.
   */
  private printChannelCache() {
    if (this.channels.size < 1) {
      console.log("[-] Channel cache is empty...");

      return;
    }

    console.log("[-] Channel cache...");

    let entry;
    for (entry of this.channels);

    for (const [channelId, channelInfo] of this.channels) {
      if (channelId === entry?.[0]) {
        console.log(
          `[-] └─ ${channelInfo.channel.name} (${channelId}) [${channelInfo.currentStatus === this.LIVE_STATUS ? this.LIVE_STATUS : "Not Live"}]`,
        );
      } else {
        console.log(
          `[-] ├─ ${channelId} [${channelInfo.currentStatus === this.LIVE_STATUS ? this.LIVE_STATUS : "Not Live"}]`,
        );
      }

      const streamers = channelInfo.discordUserIds;

      for (const streamer of streamers) {
        if (streamers.indexOf(streamer) === streamers.length - 1) {
          console.log(`[-]    └─ ${streamer}`);
        } else {
          console.log(`[-] │  ├─ ${streamer}`);
        }
      }
    }
  }
}
