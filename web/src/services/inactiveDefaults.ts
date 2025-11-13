import type { ApiError, DefaultInactiveCategoriesResponse } from "../models/types";

export const fetchDefaultInactiveCategories = async (): Promise<string[]> => {
  const response = await fetch("/api/inactive-defaults");

  if (!response.ok) {
    let message = "Failed to load default categories.";
    try {
      const payload: ApiError = await response.json();
      message = payload.message ?? message;
    } catch {
      // Ignore parse errors and fall back to the default message.
    }
    throw new Error(message);
  }

  const data: DefaultInactiveCategoriesResponse = await response.json();
  return data.categories;
};
