using GithubVariablesManager.Api.Auth;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Endpoints;

/// <summary>
/// The Auth vertical's routes — direct successor to the now-retired server/'s three relay
/// endpoints, plus the new GET /viewer (the first endpoint in this app to actually call
/// api.github.com via Octokit). Failure responses for the device-code/device-token/client-id
/// routes preserve the original flat <c>{ error }</c> JSON shape (not <c>ProblemDetails</c>) —
/// BackendOAuthGateway's Angular-side error extraction depends on it.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapGet("/github/client-id", (DeviceFlowService deviceFlowService) =>
            Results.Ok(new ClientIdResponse(deviceFlowService.GetClientId())))
            .WithName("GetGitHubClientId")
            .WithTags("Auth")
            .WithSummary("Get the GitHub OAuth App's client id for the device flow.")
            .Produces<ClientIdResponse>(200);

        group.MapPost("/github/device-code", async (DeviceFlowService deviceFlowService, CancellationToken cancellationToken) =>
        {
            try
            {
                var response = await deviceFlowService.StartDeviceFlowAsync(cancellationToken);
                return Results.Ok(response);
            }
            catch (OAuthRelayException ex)
            {
                return Results.Json(new ErrorResponse(ex.Message), statusCode: ex.StatusCode);
            }
        })
            .WithName("StartDeviceFlow")
            .WithTags("Auth")
            .WithSummary("Start the GitHub OAuth device flow, returning a device/user code pair.")
            .Produces<DeviceCodeResponse>(200)
            .Produces<ErrorResponse>(400);

        group.MapPost("/github/device-token", async (DeviceTokenRequest request, DeviceFlowService deviceFlowService, CancellationToken cancellationToken) =>
        {
            try
            {
                var response = await deviceFlowService.PollDeviceTokenAsync(request.DeviceCode, cancellationToken);
                return Results.Ok(response);
            }
            catch (OAuthRelayException ex)
            {
                return Results.Json(new ErrorResponse(ex.Message), statusCode: ex.StatusCode);
            }
        })
            .WithName("PollDeviceToken")
            .WithTags("Auth")
            .WithSummary("Poll for the device flow's resulting access token.")
            .Produces<DeviceTokenResponse>(200)
            .Produces<ErrorResponse>(400);

        group.MapGet("/viewer", async (IBearerTokenAccessor tokenAccessor, ViewerService viewerService) =>
        {
            // A *missing* header is a distinct case from a *bad* token: no Octokit call is even
            // attempted, so it can't go through PermissionErrorExceptionHandler (that only fires
            // once an Octokit.ApiException has actually been thrown).
            if (tokenAccessor.GetToken() is null)
            {
                return Results.Json(new ErrorResponse("Missing bearer token."), statusCode: 401);
            }

            var viewer = await viewerService.GetViewerAsync();
            return Results.Ok(viewer);
        })
            .WithName("GetViewer")
            .WithTags("Auth")
            .WithSummary("Get the signed-in GitHub user (login + avatar) for either sign-in method.")
            .Produces<ViewerResponse>(200)
            .Produces<ErrorResponse>(401);
    }
}
