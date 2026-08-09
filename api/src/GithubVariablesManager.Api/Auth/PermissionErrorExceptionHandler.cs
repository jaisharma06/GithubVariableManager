using Microsoft.AspNetCore.Diagnostics;

namespace GithubVariablesManager.Api.Auth;

/// <summary>
/// Global exception-to-response shape for GitHub API failures. Catches
/// <see cref="Octokit.ApiException"/> generically — this covers 401/403/404 (and anything else
/// Octokit throws for a non-2xx GitHub response) uniformly with one pattern-match;
/// <see cref="PermissionErrorClassifier"/> already only marks 403/404 as <c>locked</c>, so no
/// per-status special-casing is needed here.
/// </summary>
public sealed class PermissionErrorExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not Octokit.ApiException apiException) return false;

        var classification = PermissionErrorClassifier.Classify((int)apiException.StatusCode, apiException.Message);
        httpContext.Response.StatusCode = classification.Status;
        await httpContext.Response.WriteAsJsonAsync(classification, cancellationToken);
        return true;
    }
}
