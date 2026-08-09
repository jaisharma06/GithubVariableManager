namespace GithubVariablesManager.Api.GitHub;

// Octokit 14.0.0 has no typed client for Actions Variables/Secrets/Environments (confirmed
// against Octokit's source and its open feature requests), so ActionsRestClient.cs talks to those
// REST paths through Octokit's low-level Connection.Get<T>/Post<T>/Put/Patch<T>/Delete methods
// instead. Those generic methods deserialize via Octokit's own SimpleJsonSerializer, which — like
// every one of Octokit's own typed models (e.g. Repository.CreatedAt <-> created_at) — needs
// plain, mutable classes with settable properties, not `sealed record`s with init-only positional
// properties. Confirmed empirically in GitHub/RawActionsModelsSpikeTests.cs: plain PascalCase
// properties auto-map to GitHub's snake_case JSON with zero [Parameter(Key = "...")] attributes
// needed — Octokit's serializer applies the same PascalCase<->snake_case convention to these
// classes that it applies to its own typed models. This is a deliberate, one-off exception to this
// project's `sealed record` DTO convention for `api/`, scoped to this file only, dictated by
// Octokit's deserializer rather than a style preference.

public sealed class RawVariable
{
    public string Name { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class RawVariableListResponse
{
    public int TotalCount { get; set; }
    public List<RawVariable> Variables { get; set; } = [];
}

/// <summary>Names/metadata only — GitHub never returns a secret's value, to anyone, at any level.</summary>
public sealed class RawSecret
{
    public string Name { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string? Visibility { get; set; }
}

public sealed class RawSecretListResponse
{
    public int TotalCount { get; set; }
    public List<RawSecret> Secrets { get; set; } = [];
}

public sealed class RawEnvironment
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
}

public sealed class RawEnvironmentListResponse
{
    public int TotalCount { get; set; }
    public List<RawEnvironment> Environments { get; set; } = [];
}

/// <summary>GET .../public-key response — the recipient key a secret is sealed against.</summary>
public sealed class RawPublicKey
{
    public string KeyId { get; set; } = "";
    public string Key { get; set; } = "";
}
