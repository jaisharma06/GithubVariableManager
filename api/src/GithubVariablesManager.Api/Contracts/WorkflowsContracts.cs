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
    string HtmlUrl,
    string? CommitMessage);

public sealed record WorkflowRunJobStepResponse(
    string Name, int Number, string? Status, string? Conclusion,
    DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt);

public sealed record WorkflowRunJobResponse(
    long Id, string Name, string? Status, string? Conclusion,
    DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt,
    IReadOnlyList<WorkflowRunJobStepResponse> Steps);

public sealed record WorkflowRunDetailResponse(
    long Id, string? Name, string? DisplayTitle, string? CommitMessage,
    string? Status, string? Conclusion, string? Event,
    long RunNumber, long RunAttempt, string? HeadBranch, string? HeadSha,
    string? ActorLogin, string? ActorAvatarUrl,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? RunStartedAt,
    string HtmlUrl, IReadOnlyList<WorkflowRunJobResponse> Jobs);

public sealed record StartWorkflowRunCleanupRequest(string Org, string Repo, long WorkflowId, IReadOnlyList<long> RunIds);

public sealed record StartWorkflowRunCleanupResponse(Guid JobId);

public sealed record WorkflowRunCleanupProgressResponse(
    int Done,
    int Total,
    bool Completed,
    IReadOnlyList<long> SucceededIds,
    IReadOnlyList<long> FailedIds,
    bool PermissionDenied);
