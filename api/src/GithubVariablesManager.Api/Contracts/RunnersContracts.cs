namespace GithubVariablesManager.Api.Contracts;

public sealed record RunnerLabelResponse(long Id, string Name, string Type);
public sealed record RunnerResponse(long Id, string Name, string Os, string Status, bool Busy, IReadOnlyList<RunnerLabelResponse> Labels);
