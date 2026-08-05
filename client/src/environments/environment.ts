// Development environment (the default — used by `ng serve` and as the fallback import
// everywhere else). Swapped for environment.prod.ts on a production build via angular.json's
// fileReplacements.
export const environment = {
  production: false,
  oauthServerUrl: 'http://localhost:8787',
  // GitHub's REST API directly, today. See docs/Architecture.md's "Future ASP.NET Core seam"
  // section: swap this to the .NET backend's own base URL once it exists, and pair it with a new
  // Gateway implementation set — GithubHttp itself, and everything above it (Facades,
  // Components), stays unchanged.
  apiBaseUrl: 'https://api.github.com',
};
