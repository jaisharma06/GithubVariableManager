using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Thrown for the two "never even reached GitHub" failure paths (OAuth not configured, missing
/// device code) — a distinct concern from <see cref="Octokit.ApiException"/>, so it's caught
/// locally in <c>Endpoints/AuthEndpoints.cs</c> rather than going through the global
/// <see cref="Auth.PermissionErrorExceptionHandler"/>.
/// </summary>
public sealed class OAuthRelayException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

/// <summary>
/// Owns everything about the GitHub OAuth device flow: this app's OAuth Client ID, and the
/// GitHub-vocabulary classification of poll responses (<c>authorization_pending</c> →
/// <c>pending</c>, etc.) that used to live in Angular's <c>LocalOAuthGateway.PollDeviceToken</c>.
/// The Angular gateway now only reshapes this already-normalized <see cref="DeviceTokenResponse"/>
/// into its TS discriminated union — zero GitHub-vocabulary interpretation left client-side.
/// </summary>
public sealed class DeviceFlowService(GitHubOAuthRelayClient oauthRelayClient, IConfiguration configuration)
{
    /// <summary>
    /// This app's OAuth Client ID is baked in as a default so a fresh clone works with zero
    /// setup — unlike a client secret, an OAuth client ID isn't sensitive (it's the whole point
    /// of the device flow: it's safe to ship in a public client that can't protect a secret). Set
    /// GITHUB_OAUTH_CLIENT_ID to point at a different OAuth App instead.
    /// </summary>
    private const string DefaultClientId = "Ov23linDoABzhcxwgYnp";

    public string? GetClientId()
    {
        var configured = configuration["GITHUB_OAUTH_CLIENT_ID"];
        return string.IsNullOrWhiteSpace(configured) ? DefaultClientId : configured;
    }

    public async Task<DeviceCodeResponse> StartDeviceFlowAsync(CancellationToken cancellationToken = default)
    {
        var clientId = GetClientId();
        if (clientId is null)
        {
            throw new OAuthRelayException(500, "OAuth is not configured on this server. Set GITHUB_OAUTH_CLIENT_ID, or connect with a personal access token instead.");
        }

        var relayResult = await oauthRelayClient.RequestDeviceCodeAsync(clientId, cancellationToken);
        var data = relayResult.Data;

        if (!relayResult.IsSuccess || data.DeviceCode is null || data.UserCode is null || data.VerificationUri is null)
        {
            throw new OAuthRelayException(400, data.ErrorDescription ?? data.Error ?? "GitHub rejected the device code request.");
        }

        return new DeviceCodeResponse(data.DeviceCode, data.UserCode, data.VerificationUri, data.ExpiresIn ?? 900, data.Interval ?? 5);
    }

    public async Task<DeviceTokenResponse> PollDeviceTokenAsync(string? deviceCode, CancellationToken cancellationToken = default)
    {
        var clientId = GetClientId();
        if (clientId is null)
        {
            throw new OAuthRelayException(500, "OAuth is not configured on this server.");
        }
        if (string.IsNullOrWhiteSpace(deviceCode))
        {
            throw new OAuthRelayException(400, "Missing device code.");
        }

        var raw = await oauthRelayClient.PollDeviceTokenAsync(clientId, deviceCode, cancellationToken);

        if (!string.IsNullOrEmpty(raw.AccessToken))
        {
            return new DeviceTokenResponse("success", raw.AccessToken, null, null);
        }

        // GitHub reports "still waiting" and "slow down" as 200 responses with an `error` field —
        // this switch is the single place GitHub-vocabulary classification happens now (moved
        // server-side per the ASP.NET Core migration plan).
        return raw.Error switch
        {
            "authorization_pending" => new DeviceTokenResponse("pending", null, null, null),
            "slow_down" => new DeviceTokenResponse("slow_down", null, raw.Interval ?? 10, null),
            "access_denied" => new DeviceTokenResponse("denied", null, null, null),
            "expired_token" => new DeviceTokenResponse("expired", null, null, null),
            _ => new DeviceTokenResponse("error", null, null, raw.Error ?? "GitHub sign-in failed."),
        };
    }
}
