using System.Net;
using System.Net.Http.Json;
using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.GitHub;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace GithubVariablesManager.Api.Tests.Endpoints;

public class AuthEndpointsTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> WithFakeOAuthRelay(FakeHttpMessageHandler handler) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddHttpClient<GitHubOAuthRelayClient>(c =>
            {
                c.BaseAddress = new Uri("https://github.com");
                c.DefaultRequestHeaders.Add("Accept", "application/json");
            }).ConfigurePrimaryHttpMessageHandler(() => handler);
        }));

    private WebApplicationFactory<Program> WithFakeGitHubClient(FakeHttpMessageHandler handler) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddScoped<GitHubClientFactory>(_ => new FakeGitHubClientFactory(handler));
        }));

    [Fact]
    public async Task ClientId_ReturnsDefault_CamelCased()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/auth/github/client-id");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"clientId\":\"Ov23linDoABzhcxwgYnp\"", body);
    }

    [Fact]
    public async Task DeviceCode_Success_ReturnsCamelCasedResponse()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            {"device_code":"dc","user_code":"UC-1","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}
            """);
        var client = WithFakeOAuthRelay(handler).CreateClient();

        var response = await client.PostAsync("/api/auth/github/device-code", null);

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"deviceCode\":\"dc\"", body);
        Assert.Contains("\"userCode\":\"UC-1\"", body);
        Assert.Contains("\"verificationUri\":\"https://github.com/login/device\"", body);
    }

    [Fact]
    public async Task DeviceCode_GitHubRejects_Returns400WithFlatErrorShape()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.BadRequest, """
            {"error":"invalid_client","error_description":"bad client id"}
            """);
        var client = WithFakeOAuthRelay(handler).CreateClient();

        var response = await client.PostAsync("/api/auth/github/device-code", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"bad client id\"", body);
    }

    [Fact]
    public async Task DeviceToken_Pending_ReturnsNormalizedStatus()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """{"error":"authorization_pending"}""");
        var client = WithFakeOAuthRelay(handler).CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/github/device-token", new { deviceCode = "dc" });

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"pending\"", body);
    }

    [Fact]
    public async Task Viewer_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/auth/viewer");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task Viewer_ValidToken_ReturnsCamelCasedViewer()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            {"login":"octocat","avatar_url":"https://avatars.githubusercontent.com/u/1"}
            """);
        var client = WithFakeGitHubClient(handler).CreateClient();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "some-token");

        var response = await client.GetAsync("/api/auth/viewer");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"login\":\"octocat\"", body);
        Assert.Contains("\"avatarUrl\":\"https://avatars.githubusercontent.com/u/1\"", body);
    }

    [Fact]
    public async Task Viewer_GitHub403_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Forbidden, """
            {"message":"Resource not accessible by personal access token"}
            """);
        var client = WithFakeGitHubClient(handler).CreateClient();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "some-token");

        var response = await client.GetAsync("/api/auth/viewer");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"locked\":true", body);
        Assert.Contains("\"status\":403", body);
    }
}
