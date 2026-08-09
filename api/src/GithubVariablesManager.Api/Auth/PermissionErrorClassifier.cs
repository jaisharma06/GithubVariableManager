namespace GithubVariablesManager.Api.Auth;

public static class PermissionErrorClassifier
{
    public static GitHubPermissionError Classify(int statusCode, string message) =>
        new(Locked: statusCode is 403 or 404, Status: statusCode, Message: message);
}
