using System.Net;
using System.Net.Http.Headers;
using GithubVariablesManager.Api.GitHub;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace GithubVariablesManager.Api.Tests.Endpoints;

public class RunnersEndpointsTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> WithFakeGitHubClient(FakeHttpMessageHandler handler) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddScoped<GitHubClientFactory>(_ => new FakeGitHubClientFactory(handler));
        }));

    private static HttpClient AuthedClient(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "some-token");
        return client;
    }

    private const string RunnerJson = """
        {"total_count":1,"runners":[{"id":1,"name":"runner-one","os":"linux","status":"online","busy":false,"labels":[{"id":10,"name":"self-hosted","type":"read-only"}]}]}
        """;

    [Fact]
    public async Task Runners_ValidToken_OrgOnly_ReturnsCamelCasedRunners()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, RunnerJson);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/runners?org=octo-org");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"name\":\"runner-one\"", body);
        Assert.Contains("\"status\":\"online\"", body);
        Assert.Contains("\"labels\":[{\"id\":10,\"name\":\"self-hosted\",\"type\":\"read-only\"}]", body);
    }

    [Fact]
    public async Task Runners_ValidToken_OrgAndRepo_ReturnsCamelCasedRunners()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, RunnerJson);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/runners?org=octo-org&repo=widgets");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"name\":\"runner-one\"", body);
    }

    [Fact]
    public async Task Runners_LockedScope_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NotFound, """
            {"message":"Not Found"}
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/runners?org=octo-org");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"locked\":true", body);
        Assert.Contains("\"status\":404", body);
    }

    [Fact]
    public async Task Runners_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/runners?org=octo-org");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }
}
