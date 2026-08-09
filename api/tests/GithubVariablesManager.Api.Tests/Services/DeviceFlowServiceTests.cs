using System.Net;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;
using Microsoft.Extensions.Configuration;

namespace GithubVariablesManager.Api.Tests.Services;

public class DeviceFlowServiceTests
{
    private static DeviceFlowService CreateSut(FakeHttpMessageHandler handler, string? clientIdOverride = null)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://github.com") };
        var relayClient = new GitHubOAuthRelayClient(httpClient);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(clientIdOverride is null
                ? []
                : new Dictionary<string, string?> { ["GITHUB_OAUTH_CLIENT_ID"] = clientIdOverride })
            .Build();
        return new DeviceFlowService(relayClient, config);
    }

    [Fact]
    public void GetClientId_ReturnsDefault_WhenNotConfigured()
    {
        var sut = CreateSut(new FakeHttpMessageHandler());
        Assert.Equal("Ov23linDoABzhcxwgYnp", sut.GetClientId());
    }

    [Fact]
    public void GetClientId_ReturnsConfiguredOverride()
    {
        var sut = CreateSut(new FakeHttpMessageHandler(), clientIdOverride: "my-custom-client-id");
        Assert.Equal("my-custom-client-id", sut.GetClientId());
    }

    [Fact]
    public async Task StartDeviceFlowAsync_ReturnsResponse_OnSuccess()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """
            {"device_code":"dc","user_code":"UC-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}
            """);
        var sut = CreateSut(handler);

        var result = await sut.StartDeviceFlowAsync();

        Assert.Equal("dc", result.DeviceCode);
        Assert.Equal("UC-1234", result.UserCode);
        Assert.Equal("https://github.com/login/device", result.VerificationUri);
        Assert.Equal(900, result.ExpiresIn);
        Assert.Equal(5, result.Interval);
    }

    [Fact]
    public async Task StartDeviceFlowAsync_Throws400_WhenGitHubRejects()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.BadRequest, """
            {"error":"invalid_client","error_description":"The client_id is invalid."}
            """);
        var sut = CreateSut(handler);

        var ex = await Assert.ThrowsAsync<OAuthRelayException>(() => sut.StartDeviceFlowAsync());
        Assert.Equal(400, ex.StatusCode);
        Assert.Equal("The client_id is invalid.", ex.Message);
    }

    [Theory]
    [InlineData("authorization_pending", "pending")]
    [InlineData("access_denied", "denied")]
    [InlineData("expired_token", "expired")]
    [InlineData("some_unrecognized_error", "error")]
    public async Task PollDeviceTokenAsync_ClassifiesGitHubVocabulary(string githubError, string expectedStatus)
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, $$"""{"error":"{{githubError}}"}""");
        var sut = CreateSut(handler);

        var result = await sut.PollDeviceTokenAsync("device-code");

        Assert.Equal(expectedStatus, result.Status);
    }

    [Fact]
    public async Task PollDeviceTokenAsync_SlowDown_CarriesInterval()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """{"error":"slow_down","interval":15}""");
        var sut = CreateSut(handler);

        var result = await sut.PollDeviceTokenAsync("device-code");

        Assert.Equal("slow_down", result.Status);
        Assert.Equal(15, result.Interval);
    }

    [Fact]
    public async Task PollDeviceTokenAsync_Success_ReturnsToken()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.OK, """{"access_token":"gho_abc123"}""");
        var sut = CreateSut(handler);

        var result = await sut.PollDeviceTokenAsync("device-code");

        Assert.Equal("success", result.Status);
        Assert.Equal("gho_abc123", result.Token);
    }

    [Fact]
    public async Task PollDeviceTokenAsync_Throws400_WhenDeviceCodeMissing()
    {
        var sut = CreateSut(new FakeHttpMessageHandler());

        var ex = await Assert.ThrowsAsync<OAuthRelayException>(() => sut.PollDeviceTokenAsync(null));
        Assert.Equal(400, ex.StatusCode);
    }
}
