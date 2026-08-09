// Development environment (the default — used by `ng serve` and as the fallback import
// everywhere else). Swapped for environment.prod.ts on a production build via angular.json's
// fileReplacements.
export const environment = {
  production: false,
  // The api/ ASP.NET Core backend — see docs/Architecture.md's "The ASP.NET Core migration"
  // section. Owns the Auth vertical today (Phase 1); more resources move here as later phases
  // land, each pairing a new Backend*Gateway with a swapped App.config.ts provider.
  backendApiBaseUrl: 'http://localhost:5080',
};
