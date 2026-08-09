using System.Net;
using GithubVariablesManager.Api.Services;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests.Services;

public class ViewerServiceTests
{
    private static IGitHubClient CreateClient(FakeHttpMessageHandler handler) =>
        new GitHubClient(new Connection(
            new ProductHeaderValue("GithubVariablesManagerTests"),
            new Uri("https://api.github.com"),
            new InMemoryCredentialStore(new Credentials("test-token")),
            new HttpClientAdapter(() => handler),
            new SimpleJsonSerializer()));

    [Fact]
    public async Task MapViewerAsync_MapsOctokitUser_ToViewerResponse()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            {"login":"octocat","avatar_url":"https://avatars.githubusercontent.com/u/1"}
            """);
        var client = CreateClient(handler);

        var viewer = await ViewerService.MapViewerAsync(client);

        Assert.Equal("octocat", viewer.Login);
        Assert.Equal("https://avatars.githubusercontent.com/u/1", viewer.AvatarUrl);
    }

    [Fact]
    public async Task MapViewerAsync_401FromGitHub_SurfacesAsAuthorizationException()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Unauthorized, """
            {"message":"Bad credentials"}
            """);
        var client = CreateClient(handler);

        await Assert.ThrowsAsync<AuthorizationException>(() => ViewerService.MapViewerAsync(client));
    }
}
