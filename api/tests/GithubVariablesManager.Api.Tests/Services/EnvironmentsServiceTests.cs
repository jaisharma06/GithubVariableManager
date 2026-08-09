using System.Net;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

public class EnvironmentsServiceTests
{
    private static EnvironmentsService CreateService(FakeHttpMessageHandler handler) =>
        new(new ActionsRestClient(new FakeGitHubClientFactory(handler)));

    [Fact]
    public async Task ListEnvironmentsAsync_MapsRawEnvironments()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            {"total_count":1,"environments":[{"id":1,"name":"staging"}]}
            """);
        var service = CreateService(handler);

        var environments = await service.ListEnvironmentsAsync("octo-org", "widgets");

        var env = Assert.Single(environments);
        Assert.Equal("staging", env.Name);
        Assert.Equal(1, env.Id);
    }

    [Fact]
    public async Task ListEnvironmentsAsync_MapsRawEnvironments_WithIdBeyondInt32Range()
    {
        // GitHub's real environment ids are 64-bit and can exceed Int32.MaxValue (2,147,483,647) —
        // regression test for the OverflowException this caused when RawEnvironment/EnvironmentResponse
        // declared `int Id` instead of `long Id`.
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            {"total_count":1,"environments":[{"id":9876543210,"name":"production"}]}
            """);
        var service = CreateService(handler);

        var environments = await service.ListEnvironmentsAsync("octo-org", "widgets");

        var env = Assert.Single(environments);
        Assert.Equal("production", env.Name);
        Assert.Equal(9876543210L, env.Id);
    }

    [Fact]
    public async Task ListEnvironmentsAsync_404_ReturnsEmptyList_NotPropagatedAsAnException()
    {
        // A repo with no environments configured (or on a plan without env support) 404s here —
        // that's a "no environments" business fact, not a permission failure, so it must never
        // reach PermissionErrorExceptionHandler (which would wrongly present it as a locked
        // section).
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NotFound, """
            {"message":"Not Found"}
            """);
        var service = CreateService(handler);

        var environments = await service.ListEnvironmentsAsync("octo-org", "widgets");

        Assert.Empty(environments);
    }

    [Fact]
    public async Task CreateEnvironmentAsync_PutsTheEnvironmentPath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        await service.CreateEnvironmentAsync("octo-org", "widgets", "staging");

        Assert.Equal(HttpMethod.Put, handler.RequestedMethods[0]);
        Assert.EndsWith("/repos/octo-org/widgets/environments/staging", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteEnvironmentAsync_DeletesTheEnvironmentPath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        await service.DeleteEnvironmentAsync("octo-org", "widgets", "staging");

        Assert.Equal(HttpMethod.Delete, handler.RequestedMethods[0]);
        Assert.EndsWith("/repos/octo-org/widgets/environments/staging", handler.RequestedPaths[0]);
    }
}
