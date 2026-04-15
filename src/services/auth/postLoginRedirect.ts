export const getPostLoginRedirectUrl = (isProduction: boolean): string => {
  if (isProduction) {
    return "/";
  }

  return process.env.WEB_APP_URL ?? "/";
};
