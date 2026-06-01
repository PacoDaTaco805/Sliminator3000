import { clientId, clientSecret } from "./twitchApiClientConfig.json";

type TwitchToken = {
  access_token: string;
  expires_at: number;
};

type Stream = {
  id: string;
  user_name: string;
  type: string;
  title: string;
};

type StreamResponse = {
  data: Stream[];
};

/**
 * Provides a simple API for checking if a twitch streamer is live.
 */
export class TwitchApiClient {
  private twitchToken: TwitchToken | null = null;

  /**
   * Initializes this Twitch Connector which simply means getting an access token.
   */
  async initialize() {
    console.log("[-] Initializing Twitch API Client...");
    // URL to send fetch request to
    const url =
      `https://id.twitch.tv/oauth2/token` +
      `?client_id=${clientId}` +
      `&client_secret=${clientSecret}` +
      `&grant_type=client_credentials`;

    // Fetch request options
    const options = {
      method: "POST",
    };

    console.log("[-] Attempting to fetch twitch access token...");

    // Attempting to get access token
    const response = await fetch(url, options);

    // Did we get a OK response?
    if (!response.ok) {
      throw new Error(`Failed to get twitch access token ${response.status}`);
    }

    console.log("[-] Response from Twitch is OK...");

    // Convert response to json and then cast to TwitchToken
    const twitchToken = (await response.json()) as TwitchToken;

    // Update accessToken to new value
    this.twitchToken = twitchToken;

    console.log(
      `[-] Successfully retrieved twitch access token: [${this.twitchToken.access_token}]`,
    );
  }

  /**
   * Checks if a streamer with the given twitchId is live on twitch at the time of the method call.
   * @param twitchId The twitch ID of the streamer who we are checking the live status of.
   * @returns true is returned if the streamer is live.
   */
  async isLive(twitchId: string): Promise<boolean> {
    console.log(`[-] Checking if [${twitchId}] is live on twitch...`);

    this.ensureTokenExists();

    // Endpoint for retrieving stream status from twitch
    const url = `https://api.twitch.tv/helix/streams?user_login=${twitchId}`;

    // Options for fetch requerst for stream status
    const options = {
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${this.twitchToken?.access_token}`,
      },
    };

    // Attempting to fetch stream status
    const response = await fetch(url, options);

    // Did we get an OK response?
    if (!response.ok) {
      throw new Error(`Failed to get stream status... ${response.status}`);
    }

    // Converting response to json and then casting to TwitchStreamStatus
    const castResponse = (await response.json()) as StreamResponse;

    // If the data array in the response is empty, it implies the stream is not live
    if (castResponse.data.length < 1) {
      console.log(`[-] Streamer [${twitchId}] is not live...`);
      return false;
    } else {
      console.log(`[-] Streamer [${twitchId}] is live 🔴...`);
      return true;
    }
  }

  /**
   * Checks if there is an access token and if it is still valid.
   * If the token is invalid, {@link initialize} is called to get
   * a new access token.
   */
  private ensureTokenExists(): void {
    console.log("[-] Checking if access token is valid...");

    if (!this.twitchToken) {
      console.log("[-] Missing access token...");
      console.log("[-] Reinitializing token...");
      this.initialize();
      return;
    }

    if (this.twitchToken.expires_at <= Date.now()) {
      console.log(
        `[-] Token expired. \n\tToken time: ${this.twitchToken.expires_at}\n\tCurrent time: ${Date.now()}`,
      );
      console.log("[-] Reinitializing token...");
      this.initialize();
      return;
    }

    console.log("[-] Token is valid...");
  }
}
