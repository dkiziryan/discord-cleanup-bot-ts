import type { DefaultChannelsResponse } from "../models/types";

export const fetchDefaultChannels = async (): Promise<string[]> => {
  const response = await fetch("/api/default-channels");

  if (!response.ok) {
    throw new Error("Failed to load default channels.");
  }

  const payload: DefaultChannelsResponse = await response.json();
  return payload.channels;
};
