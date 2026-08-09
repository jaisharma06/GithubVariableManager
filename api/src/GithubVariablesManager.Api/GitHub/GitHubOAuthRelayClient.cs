using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace GithubVariablesManager.Api.GitHub;

/// <summary>
/// Raw-<see cref="HttpClient"/> wrapper relaying GitHub's two device-flow endpoints
/// (github.com/login/device/...). Deliberately NOT Octokit: Octokit.NET's <c>OAuthClient</c>
/// implements the classic web flow (needs a client secret), not the device flow. Registered as a
/// typed client in Program.cs, base address <c>https://github.com</c>.
/// </summary>
public sealed class GitHubOAuthRelayClient(HttpClient httpClient)
{
    public async Task<DeviceCodeRelayResult> RequestDeviceCodeAsync(string clientId, CancellationToken cancellationToken = default)
    {
        using var response = await httpClient.PostAsJsonAsync(
            "/login/device/code",
            new { client_id = clientId, scope = "repo admin:org" },
            cancellationToken);

        var data = await response.Content.ReadFromJsonAsync<RawDeviceCodeResponse>(cancellationToken: cancellationToken)
            ?? new RawDeviceCodeResponse(null, null, null, null, null, null, null);

        return new DeviceCodeRelayResult(response.IsSuccessStatusCode, data);
    }

    public async Task<RawDeviceTokenResponse> PollDeviceTokenAsync(string clientId, string deviceCode, CancellationToken cancellationToken = default)
    {
        using var response = await httpClient.PostAsJsonAsync(
            "/login/oauth/access_token",
            new { client_id = clientId, device_code = deviceCode, grant_type = "urn:ietf:params:oauth:grant-type:device_code" },
            cancellationToken);

        return await response.Content.ReadFromJsonAsync<RawDeviceTokenResponse>(cancellationToken: cancellationToken)
            ?? new RawDeviceTokenResponse(null, null, null);
    }
}

public sealed record DeviceCodeRelayResult(bool IsSuccess, RawDeviceCodeResponse Data);

/// <summary>GitHub's raw (snake_case) <c>POST /login/device/code</c> response shape.</summary>
public sealed record RawDeviceCodeResponse(
    [property: JsonPropertyName("device_code")] string? DeviceCode,
    [property: JsonPropertyName("user_code")] string? UserCode,
    [property: JsonPropertyName("verification_uri")] string? VerificationUri,
    [property: JsonPropertyName("expires_in")] int? ExpiresIn,
    [property: JsonPropertyName("interval")] int? Interval,
    [property: JsonPropertyName("error")] string? Error,
    [property: JsonPropertyName("error_description")] string? ErrorDescription);

/// <summary>GitHub's raw (snake_case) <c>POST /login/oauth/access_token</c> response shape.</summary>
public sealed record RawDeviceTokenResponse(
    [property: JsonPropertyName("access_token")] string? AccessToken,
    [property: JsonPropertyName("error")] string? Error,
    [property: JsonPropertyName("interval")] int? Interval);
