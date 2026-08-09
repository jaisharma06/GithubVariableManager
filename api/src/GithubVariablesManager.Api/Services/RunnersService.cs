using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using Octokit;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Self-hosted runners lookup for the dashboard's runners panel — org runners for an org-only
/// scope, repo runners for a repo scope. Unlike the Ledger vertical's Actions
/// Variables/Secrets/Environments, Octokit.NET does have a real typed client for this
/// (<c>Actions.SelfHostedRunners</c>), confirmed against Octokit 14.0.0's shipped assembly, so no
/// <see cref="ActionsRestClient"/> involvement is needed here. No try/catch — a bad/expired token
/// or a locked (403/404) org/repo surfaces as <see cref="Octokit.ApiException"/>, which propagates
/// to the global <see cref="Auth.PermissionErrorExceptionHandler"/> uncaught.
/// </summary>
public sealed class RunnersService(GitHubClientFactory gitHubClientFactory)
{
    // Deliberately capped at a single page of 100 — matches the pre-migration Angular Gateway's
    // per_page=100 single-page behavior exactly (GithubRunnersGateway.service.ts never paginated
    // past the first page). Fixing that cap is a real user-facing behavior change and out of scope
    // for this migration phase.
    public async Task<IReadOnlyList<Contracts.RunnerResponse>> ListRunnersAsync(string org, string? repo)
    {
        var runners = gitHubClientFactory.CreateForCurrentUser().Actions.SelfHostedRunners;
        var options = new ApiOptions { PageSize = 100, PageCount = 1 };
        var response = string.IsNullOrEmpty(repo)
            ? await runners.ListAllRunnersForOrganization(org, options)
            : await runners.ListAllRunnersForRepository(org, repo, options);
        return response.Runners.Select(ToRunnerResponse).ToList();
    }

    // Explicitly Contracts.RunnerResponse — Octokit itself ships its own RunnerResponse (the
    // total_count/runners list wrapper), which `using Octokit;` above would otherwise collide with.
    private static Contracts.RunnerResponse ToRunnerResponse(Runner r) =>
        new(r.Id, r.Name, r.Os, r.Status, r.Busy, r.Labels.Select(l => new RunnerLabelResponse(l.Id, l.Name, l.Type)).ToList());
}
