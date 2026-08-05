// Production environment — swapped in for environment.ts on a production build (see
// angular.json's fileReplacements). This app is a local/personal tool, not a hosted multi-tenant
// service, so there's no separate hosted default to point at; edit oauthServerUrl before a real
// deployment, the same way a real deployment of web/ would set VITE_SERVER_URL.
export const environment = {
  production: true,
  oauthServerUrl: 'http://localhost:8787',
  apiBaseUrl: 'https://api.github.com',
};
