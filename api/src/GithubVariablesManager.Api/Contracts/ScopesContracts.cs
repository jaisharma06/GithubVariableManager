namespace GithubVariablesManager.Api.Contracts;

public sealed record OrgResponse(string Login, string AvatarUrl);
public sealed record RepoResponse(long Id, string Name, string FullName, string Owner, bool Private);
public sealed record AccountTypeResponse(string Type);
