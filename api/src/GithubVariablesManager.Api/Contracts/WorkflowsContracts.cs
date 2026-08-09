namespace GithubVariablesManager.Api.Contracts;

public sealed record WorkflowResponse(long Id, string Name, string Path, string State);

public sealed record WorkflowRunResponse(
    long Id,
    string? Name,
    string? Status,
    string? Conclusion,
    long RunNumber,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string HtmlUrl);

public sealed record StartWorkflowRunCleanupRequest(string Org, string Repo, long WorkflowId, IReadOnlyList<long> RunIds);

public sealed record StartWorkflowRunCleanupResponse(Guid JobId);

public sealed record WorkflowRunCleanupProgressResponse(
    int Done,
    int Total,
    bool Completed,
    IReadOnlyList<long> SucceededIds,
    IReadOnlyList<long> FailedIds,
    bool PermissionDenied);
