using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using Octokit;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Orgs/repos lookup used by the scope picker, plus the account-type check that decides whether
/// org-level Actions variables/secrets are even applicable for a given owner. No try/catch — a
/// bad/expired token or a locked (403/404) org/repo surfaces as <see cref="Octokit.ApiException"/>,
/// which propagates to the global <see cref="Auth.PermissionErrorExceptionHandler"/> uncaught.
/// </summary>
public sealed class ScopesService(GitHubClientFactory gitHubClientFactory)
{
    // Deliberately capped at a single page of 100 — matches the pre-migration Angular Gateway's
    // behavior exactly (ListMyOrgs/ListMyRepos never paginated past the first page). Fixing that
    // cap is a real user-facing behavior change and out of scope for this migration phase.
    public async Task<IReadOnlyList<OrgResponse>> ListMyOrgsAsync()
    {
        var orgs = await gitHubClientFactory.CreateForCurrentUser().Organization
            .GetAllForCurrent(new ApiOptions { PageSize = 100, PageCount = 1 });
        return orgs.Select(o => new OrgResponse(o.Login, o.AvatarUrl)).ToList();
    }

    public async Task<IReadOnlyList<RepoResponse>> ListMyReposAsync()
    {
        var request = new RepositoryRequest { Sort = RepositorySort.Pushed, Affiliation = RepositoryAffiliation.All };
        var repos = await gitHubClientFactory.CreateForCurrentUser().Repository
            .GetAllForCurrent(request, new ApiOptions { PageSize = 100, PageCount = 1 });
        return repos.Select(ToRepoResponse).ToList();
    }

    // Fully paginates (no PageCount limit) — matches the pre-migration Angular Gateway's
    // PaginateArray loop, unlike the two methods above.
    public async Task<IReadOnlyList<RepoResponse>> ListOrgReposAsync(string org)
    {
        var repos = await gitHubClientFactory.CreateForCurrentUser().Repository
            .GetAllForOrg(org, new ApiOptions { PageSize = 100 });
        return repos.Select(ToRepoResponse).ToList();
    }

    public async Task<AccountTypeResponse> GetAccountTypeAsync(string login)
    {
        var user = await gitHubClientFactory.CreateForCurrentUser().User.Get(login);
        return new AccountTypeResponse(user.Type == AccountType.Organization ? "Organization" : "User");
    }

    private static RepoResponse ToRepoResponse(Repository r) => new(r.Id, r.Name, r.FullName, r.Owner.Login, r.Private);
}
