let useDatabaseInLocalDevelopment = false;

export const isLocalDevDataToggleAvailable = (): boolean =>
  process.env.NODE_ENV !== "production";

export const shouldUseDatabaseIgnoredUsers = (): boolean => {
  if (!isLocalDevDataToggleAvailable()) {
    return true;
  }

  return useDatabaseInLocalDevelopment;
};

export const getLocalDevIgnoredUserSource = () => ({
  available: isLocalDevDataToggleAvailable(),
  useProductionData: shouldUseDatabaseIgnoredUsers(),
});

export const setLocalDevIgnoredUserSource = (
  useProductionData: boolean,
) => {
  if (!isLocalDevDataToggleAvailable()) {
    return getLocalDevIgnoredUserSource();
  }

  useDatabaseInLocalDevelopment = useProductionData;
  return getLocalDevIgnoredUserSource();
};
