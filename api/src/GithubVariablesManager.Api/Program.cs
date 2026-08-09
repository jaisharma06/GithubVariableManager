using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.Endpoints;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

// CORS — comma-separated WEB_ORIGIN env var, falling back to the live app (client/, :4200) and
// the archived React app (archive/web/, :5173) if unset (the same pattern the old server/ relay,
// now retired, used).
var defaultWebOrigins = new[] { "http://localhost:4200", "http://localhost:5173" };
var webOriginsSetting = builder.Configuration["WEB_ORIGIN"];
var webOrigins = string.IsNullOrWhiteSpace(webOriginsSetting)
    ? defaultWebOrigins
    : webOriginsSetting.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy.WithOrigins(webOrigins).AllowAnyHeader().AllowAnyMethod());
});

// Auth plumbing — stateless bearer-token pass-through + centralized permission-error shape.
// See Auth/ and api/README.md. No GitHub-calling code exists yet; later phases wire GitHub/*Client
// wrappers to IBearerTokenAccessor and throw exceptions PermissionErrorExceptionHandler classifies.
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IBearerTokenAccessor, HttpContextBearerTokenAccessor>();
builder.Services.AddExceptionHandler<PermissionErrorExceptionHandler>();
builder.Services.AddProblemDetails();

// Auth vertical — the two device-flow relay calls stay on a raw typed HttpClient (Octokit.NET's
// OAuthClient doesn't support the device flow), while GET /api/auth/viewer goes through Octokit
// via GitHubClientFactory. Later phases register more GitHub/*Client wrappers and
// Services/*Service orchestration classes here, mirroring the Angular Gateway/Facade split (see
// api/README.md).
builder.Services.AddHttpClient<GitHubOAuthRelayClient>(c =>
{
    c.BaseAddress = new Uri("https://github.com");
    c.DefaultRequestHeaders.Add("Accept", "application/json");
});
builder.Services.AddScoped<GitHubClientFactory>();
builder.Services.AddScoped<DeviceFlowService>();
builder.Services.AddScoped<ViewerService>();

// Scopes vertical — orgs/repos lookup for the scope picker + account-type check, both via Octokit
// through the same GitHubClientFactory.
builder.Services.AddScoped<ScopesService>();

// Runners vertical (Phase 4) — self-hosted runners for the dashboard's runners panel. Unlike the
// Ledger vertical, Octokit.NET does have a typed client for this (Actions.SelfHostedRunners), so
// RunnersService goes straight through GitHubClientFactory, no ActionsRestClient involvement.
builder.Services.AddScoped<RunnersService>();

// Workflows vertical (Phase 5) — list workflows/runs and single-run delete go through Octokit's
// typed client (Actions.Workflows), same shape as RunnersService. The chunked bulk-run-delete
// (WorkflowRunCleanupService) is a Singleton, not Scoped — its in-memory job state must survive
// across the separate "start" and "poll" HTTP requests (separate DI scopes each); see its own doc
// comment for why that's safe here and not a "database" in disguise.
builder.Services.AddScoped<WorkflowsService>();
builder.Services.AddSingleton<WorkflowRunCleanupService>();

// Ledger vertical — the merged read (variables + secrets + environment fan-out + locked-section
// classification), Variables CRUD (Phase 3a), Secrets CRUD (Phase 3b, including
// SecretSealingService's server-side libsodium sealed-box step, replacing the old
// client/src/app/core/services/SecretSealingService.ts), and Environments CRUD/rename (Phase 3c,
// closing out the Ledger vertical entirely). Octokit.NET has no typed client for Actions
// Variables/Secrets/Environments, so ActionsRestClient wraps Octokit's low-level Connection
// methods against those REST paths directly; LedgerService/EnvironmentsService/ItemMutationService/
// EnvironmentRenameService all go through it rather than duplicating URL-building.
builder.Services.AddScoped<ActionsRestClient>();
builder.Services.AddScoped<LedgerService>();
builder.Services.AddScoped<EnvironmentsService>();
builder.Services.AddScoped<SecretSealingService>();
builder.Services.AddScoped<ItemMutationService>();
builder.Services.AddScoped<EnvironmentRenameService>();

// Phase 6 — batch copy/delete-everywhere orchestration, moved server-side from CopyFacade/
// DeleteEverywhereFacade's old client-side Promise.allSettled fan-out. Both are Scoped, not
// Singleton — no state needs to survive between requests (unlike WorkflowRunCleanupService above),
// Task.WhenAll fan-out within one request is sufficient.
builder.Services.AddScoped<CopyService>();
builder.Services.AddScoped<DeleteEverywhereService>();

// Swagger/OpenAPI (dev-only) — see api/README.md "Local dev". Swashbuckle.AspNetCore, not the
// first-party Microsoft.AspNetCore.OpenApi, because this needs the actual interactive Swagger UI,
// not just document generation.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "GitHub Variables Manager API", Version = "v1" });

    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Description = "Paste a GitHub personal access token or OAuth token as: Bearer {token}",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer"
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } },
            Array.Empty<string>()
        }
    });
});

var app = builder.Build();

app.UseExceptionHandler();
app.UseCors();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(); // /swagger — the default RoutePrefix
}

// { ok: true } — the same shape the old server/ relay's GET /health used.
app.MapGet("/health", () => Results.Ok(new { ok = true }));

app.MapAuthEndpoints();
app.MapScopesEndpoints();
app.MapLedgerEndpoints();
app.MapRunnersEndpoints();
app.MapWorkflowsEndpoints();

app.Run();

// Exposed for WebApplicationFactory<Program> in the xUnit test project.
public partial class Program { }
