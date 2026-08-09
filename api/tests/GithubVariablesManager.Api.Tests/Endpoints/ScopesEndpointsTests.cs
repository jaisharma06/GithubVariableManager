using System.Net;
using System.Net.Http.Headers;
using GithubVariablesManager.Api.GitHub;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace GithubVariablesManager.Api.Tests.Endpoints;

public class ScopesEndpointsTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
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

    [Fact]
    public async Task Orgs_ValidToken_ReturnsCamelCasedOrgs()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            [{"login":"octo-org","avatar_url":"https://avatars.githubusercontent.com/o/1"}]
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/scopes/orgs");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"login\":\"octo-org\"", body);
        Assert.Contains("\"avatarUrl\":\"https://avatars.githubusercontent.com/o/1\"", body);
    }

    [Fact]
    public async Task Repos_ValidToken_ReturnsCamelCasedRepos()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            [{"id":1,"name":"repo-one","full_name":"octocat/repo-one","owner":{"login":"octocat"},"private":false}]
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/scopes/repos");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"fullName\":\"octocat/repo-one\"", body);
        Assert.Contains("\"owner\":\"octocat\"", body);
        Assert.Contains("\"private\":false", body);
    }

    [Fact]
    public async Task OrgRepos_ValidToken_ReturnsCamelCasedRepos()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            [{"id":2,"name":"repo-two","full_name":"octo-org/repo-two","owner":{"login":"octo-org"},"private":true}]
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/scopes/orgs/octo-org/repos");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"fullName\":\"octo-org/repo-two\"", body);
    }

    [Fact]
    public async Task OrgRepos_LockedScope_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NotFound, """
            {"message":"Not Found"}
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/scopes/orgs/octo-org/repos");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"locked\":true", body);
        Assert.Contains("\"status\":404", body);
    }

    [Theory]
    [InlineData("Organization")]
    [InlineData("User")]
    public async Task AccountType_ValidToken_ReturnsMappedType(string type)
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, $$"""
            {"login":"octocat","type":"{{type}}"}
            """);
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/scopes/accounts/octocat/type");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains($$"""{"type":"{{type}}"}""", body);
    }

    [Fact]
    public async Task Orgs_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/scopes/orgs");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }
}
