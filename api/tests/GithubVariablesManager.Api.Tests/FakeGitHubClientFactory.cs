using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.GitHub;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests;

/// <summary>
/// Shared test double: an Octokit <see cref="IGitHubClient"/> factory wired to a
/// <see cref="FakeHttpMessageHandler"/> instead of real api.github.com. Originally introduced in
/// AuthEndpointsTests.cs; extracted here once ScopesEndpointsTests.cs needed the identical double,
/// matching this test project's shared-double convention (see FakeHttpMessageHandler.cs).
/// </summary>
public sealed class FakeGitHubClientFactory(FakeHttpMessageHandler handler) : GitHubClientFactory(new NullBearerTokenAccessor())
{
    public override IGitHubClient CreateForCurrentUser() => new GitHubClient(new Connection(
        new ProductHeaderValue("GithubVariablesManagerTests"),
        new Uri("https://api.github.com"),
        new InMemoryCredentialStore(new Credentials("test-token")),
        new HttpClientAdapter(() => handler),
        new SimpleJsonSerializer()));
}

/// <summary>Shared test double: a bearer-token accessor that always reports "no token".</summary>
public sealed class NullBearerTokenAccessor : IBearerTokenAccessor
{
    public string? GetToken() => null;
}
