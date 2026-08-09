namespace GithubVariablesManager.Api.Auth;

public sealed class HttpContextBearerTokenAccessor(IHttpContextAccessor httpContextAccessor) : IBearerTokenAccessor
{
    private const string BearerPrefix = "Bearer ";

    public string? GetToken()
    {
        var header = httpContextAccessor.HttpContext?.Request.Headers.Authorization;
        if (header is not { Count: > 0 } values) return null;

        var raw = values.ToString();
        if (string.IsNullOrWhiteSpace(raw) || !raw.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = raw[BearerPrefix.Length..].Trim();
        return string.IsNullOrEmpty(token) ? null : token;
    }
}
