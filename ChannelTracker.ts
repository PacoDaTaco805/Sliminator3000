import { type Client, type VoiceBasedChannel } from "discord.js";
import type { VoiceState } from "discord.js";
import { TwitchApiClient } from "./TwitchApiClient";

type MemberInfo = {
  readonly discordUserId: string;
  readonly twitchUserId: string;
};

type VoiceStateUpdateEvent = {
  oldState: VoiceState;
  newState: VoiceState;
};

type TacoChannel = {
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
  private LIVE_STATUS = "🔴 Live";
  private NOT_LIVE_STATUS = "";

  memberInfo: MemberInfo[];
  client: Client;
  twitchConnector: TwitchApiClient;
  liveStatusCheckingInterval: number;
  liveStatusChecker: NodeJS.Timeout | undefined;

  channels = new Map<string, TacoChannel>();

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

    this.initialize();

    this.startLiveStatusChecker();
  }

  /**
   * Used for when the bot first starts and there could
   * be users already in channels that are live. This
   * will iterate through all guild, all channels of
   * those guild, all users in those channels of those
   * guilds that are live, and add them to teh cache and
   * update the channel statuses accordingly.
   */
  private initialize() {
    const guilds = this.client.guilds.cache;

    guilds.forEach((guild) =>
      guild.channels.cache
        .filter((channel) => channel.isVoiceBased())
        .forEach((voiceBasedChannel) =>
          voiceBasedChannel.members
            .filter((member) => this.isLive(member.id))
            .forEach((liveMember) =>
              this.addMemberToChannel(voiceBasedChannel, liveMember.id),
            ),
        ),
    );
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
   * Updates teh cache to reflect any changes in members joining, switching, or leaving voice channels. This will also restart the {@link liveStatusChecker}.
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

    // Is the member a streamer?
    if (!this.isStreamer(newState.member.id)) {
      console.log("[-] Member is not a streamer. Skipping...");
      return;
    }

    const memberAction = this.getMemberAction(event);

    console.log(`[-] Member performed [${memberAction}] action`);

    console.log("[-] Stopping live status checker...");
    this.stopLiveStatusChecker();

    switch (memberAction) {
      case MemberAction.JOINED_CHANNEL:
        if (!newState.channel) {
          console.log("[-] Missing new state channel. Skipping...");
          return;
        }

        this.addMemberToChannel(newState.channel, newState.member.id);

        break;

      case MemberAction.SWITCHED_CHANNELS:
        if (!oldState.channel || !newState.channel) {
          console.log("[-] Missing old or new state channel. Skipping...");
          return;
        }

        this.switchMemberToChannel(
          oldState.channel,
          newState.channel,
          newState.member.id,
        );

        break;

      case MemberAction.REMAINED_IN_CHANNEL:
        console.log("[-] Member stayed in same channel. No work to do...");
        return;

      case MemberAction.LEFT_CHANNEL:
        if (!oldState.channel) {
          console.log("[-] Missing old state channel. Skipping...");
          return;
        }

        this.removeMemberFromChannel(oldState.channel, oldState.member.id);

        break;
    }

    this.startLiveStatusChecker();
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
   * Removes a member from a channel in the cache.
   * @param channel The channel the user is to be removed from
   * @param discordUserId The Discord user ID of the member who is being removed.
   */
  private removeMemberFromChannel(
    channel: VoiceBasedChannel,
    discordUserId: string,
  ) {
    const currentValue = this.channels.get(channel.id);

    if (currentValue != null) {
      currentValue.discordUserIds = currentValue.discordUserIds.filter(
        (userId) => userId !== discordUserId,
      );
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
    console.log("[-] Updating channel statuses...");
    for (const [channelId, channelWithMembers] of this.channels) {
      if (channelWithMembers.discordUserIds.length < 1) {
        if (channelWithMembers.currentStatus == this.NOT_LIVE_STATUS) {
          console.log("[-] Channel already has this status. Skipping...");
        }
        this.clearChannelStatus(channelWithMembers.channel);
        this.channels.delete(channelId);
      } else {
        for (const discordUserId of channelWithMembers.discordUserIds) {
          if (await this.isLive(discordUserId)) {
            if (channelWithMembers.currentStatus == this.LIVE_STATUS) {
              console.log("[-] Channel already has this status. Skipping...");
            }
            this.setChannelStatus(channelWithMembers.channel);
          } else {
            if (channelWithMembers.currentStatus == this.NOT_LIVE_STATUS) {
              console.log("[-] Channel already has this status. Skipping...");
            }
            this.clearChannelStatus(channelWithMembers.channel);
          }
        }
      }
    }
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
}
