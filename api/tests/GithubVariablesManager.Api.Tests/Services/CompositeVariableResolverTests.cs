using System.Net;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

public class CompositeVariableResolverTests
{
    private static CompositeVariableResolver CreateResolver(FakeHttpMessageHandler handler) =>
        new(new ActionsRestClient(new FakeGitHubClientFactory(handler)));

    [Theory]
    [InlineData("$(BASE_URL)/cdn", true)]
    [InlineData("plain-value", false)]
    [InlineData("no dollar parens (BASE_URL)", false)]
    public void IsComposite_MatchesOnlyTheDollarParenPattern(string value, bool expected)
    {
        Assert.Equal(expected, CompositeVariableResolver.IsComposite(value));
    }

    [Fact]
    public void ExtractReferences_ReturnsEachDistinctNameOnce()
    {
        var refs = CompositeVariableResolver.ExtractReferences("$(A)/$(B)/$(A)");

        Assert.Equal(["A", "B"], refs);
    }

    [Fact]
    public void Resolve_SubstitutesEveryKnownReference()
    {
        var resolver = CreateResolver(new FakeHttpMessageHandler());
        var lookup = new Dictionary<string, string> { ["BASE_URL"] = "https://example.com" };

        var result = resolver.Resolve("CDN", "$(BASE_URL)/cdn", lookup);

        Assert.Equal("https://example.com/cdn", result.ResolvedValue);
        Assert.Empty(result.UnresolvedReferences);
        Assert.False(result.Circular);
    }

    [Fact]
    public void Resolve_ResolvesNestedCompositeReferencesRecursively()
    {
        var resolver = CreateResolver(new FakeHttpMessageHandler());
        var lookup = new Dictionary<string, string> { ["A"] = "1", ["B"] = "$(A)-2", ["C"] = "$(B)-3" };

        var result = resolver.Resolve("D", "$(C)-4", lookup);

        Assert.Equal("1-2-3-4", result.ResolvedValue);
        Assert.False(result.Circular);
    }

    [Fact]
    public void Resolve_ForwardReferenceToAMissingName_IsUnresolvedNotBlocked()
    {
        var resolver = CreateResolver(new FakeHttpMessageHandler());
        var lookup = new Dictionary<string, string>();

        var result = resolver.Resolve("CDN", "$(NOT_YET_CREATED)/cdn", lookup);

        Assert.False(result.Circular);
        Assert.Equal(["NOT_YET_CREATED"], result.UnresolvedReferences);
        // The broken reference stays visible as literal text rather than being blanked out.
        Assert.Equal("$(NOT_YET_CREATED)/cdn", result.ResolvedValue);
    }

    [Fact]
    public void Resolve_DirectSelfReference_IsCircular()
    {
        var resolver = CreateResolver(new FakeHttpMessageHandler());
        var lookup = new Dictionary<string, string> { ["A"] = "$(A)" };

        var result = resolver.Resolve("A", "$(A)", lookup);

        Assert.True(result.Circular);
        Assert.Null(result.ResolvedValue);
        Assert.Contains("A -> A", result.CircularError);
    }

    [Fact]
    public void Resolve_IndirectCycle_IsCircular()
    {
        var resolver = CreateResolver(new FakeHttpMessageHandler());
        var lookup = new Dictionary<string, string> { ["A"] = "$(B)", ["B"] = "$(C)", ["C"] = "$(A)" };

        var result = resolver.Resolve("A", "$(B)", lookup);

        Assert.True(result.Circular);
        Assert.Null(result.ResolvedValue);
    }

    [Fact]
    public void BuildLookupFromItems_AppliesEnvironmentOverRepositoryOverOrganizationPrecedence()
    {
        var items = new List<LedgerItemResponse>
        {
            new("variable", "organization", "octo-org", null, null, "SHARED", "org-value", null, default, default),
            new("variable", "repository", "octo-org", "widgets", null, "SHARED", "repo-value", null, default, default),
            new("variable", "environment", "octo-org", "widgets", "prod", "SHARED", "env-value", null, default, default),
            new("variable", "repository", "octo-org", "widgets", null, "REPO_ONLY", "r", null, default, default),
        };

        var lookup = CompositeVariableResolver.BuildLookupFromItems(items, "environment", "octo-org", "widgets", "prod");

        Assert.Equal("env-value", lookup["SHARED"]);
        Assert.Equal("r", lookup["REPO_ONLY"]);
    }

    [Fact]
    public void BuildLookupFromItems_OrganizationLevelItem_OnlySeesOrganizationNames()
    {
        var items = new List<LedgerItemResponse>
        {
            new("variable", "organization", "octo-org", null, null, "ORG_VAR", "o", null, default, default),
            new("variable", "repository", "octo-org", "widgets", null, "REPO_VAR", "r", null, default, default),
        };

        var lookup = CompositeVariableResolver.BuildLookupFromItems(items, "organization", "octo-org", null, null);

        Assert.True(lookup.ContainsKey("ORG_VAR"));
        Assert.False(lookup.ContainsKey("REPO_VAR"));
    }

    [Fact]
    public void BuildLookupFromItems_ExcludesSecretsAndOtherOrgs()
    {
        var items = new List<LedgerItemResponse>
        {
            new("secret", "organization", "octo-org", null, null, "A_SECRET", null, "all", default, default),
            new("variable", "organization", "other-org", null, null, "OTHER_ORG_VAR", "x", null, default, default),
        };

        var lookup = CompositeVariableResolver.BuildLookupFromItems(items, "organization", "octo-org", null, null);

        Assert.Empty(lookup);
    }

    [Fact]
    public async Task BuildLookupAsync_RepositoryLevel_FetchesOrganizationThenRepositoryOnly()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"ORG_VAR","value":"o","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"REPO_VAR","value":"r","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""");
        var resolver = CreateResolver(handler);

        var lookup = await resolver.BuildLookupAsync("octo-org", "widgets", null, "repository");

        Assert.Equal(2, handler.RequestedPaths.Count);
        Assert.StartsWith("/orgs/octo-org/actions/variables", handler.RequestedPaths[0]);
        Assert.StartsWith("/repos/octo-org/widgets/actions/variables", handler.RequestedPaths[1]);
        Assert.Equal("o", lookup["ORG_VAR"]);
        Assert.Equal("r", lookup["REPO_VAR"]);
    }

    [Fact]
    public async Task BuildLookupAsync_LockedLevel_ContributesNothing_DoesNotThrow()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var resolver = CreateResolver(handler);

        var lookup = await resolver.BuildLookupAsync("octo-org", null, null, "organization");

        Assert.Empty(lookup);
    }
}
