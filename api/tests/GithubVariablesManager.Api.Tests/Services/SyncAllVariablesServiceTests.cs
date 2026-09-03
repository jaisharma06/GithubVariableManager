using System.Net;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

/// <summary>
/// <see cref="SyncAllVariablesService.SyncAllAsync"/> fans out over targets with
/// <see cref="Task.WhenAll"/> — same genuinely-concurrent-consumer-of-<see cref="FakeHttpMessageHandler"/>
/// category as <see cref="DeleteEverywhereServiceTests"/> (see its own doc comment). The mixed-outcome
/// test below scripts a single universal response, reused identically for every request regardless
/// of shape or target — deliberately, so the result is correct no matter which physical request
/// dequeues which queued copy under concurrent interleaving, avoiding any dependency on request
/// order the same way <see cref="DeleteEverywhereServiceTests"/>'s "all succeed" tests do. It works
/// here because: a GET parses it as a valid variable list either way (manifest read or scope
/// lookup), and a PATCH's <c>Connection.Patch&lt;object&gt;</c> deserializes any valid JSON body
/// without caring about its shape.
/// </summary>
public class SyncAllVariablesServiceTests
{
    private static SyncAllVariablesService CreateService(FakeHttpMessageHandler handler)
    {
        var actionsRestClient = new ActionsRestClient(new FakeGitHubClientFactory(handler));
        var itemMutationService = new ItemMutationService(actionsRestClient, new SecretSealingService(), new CompositeVariableResolver(actionsRestClient), new CompositeManifestService(actionsRestClient));
        return new SyncAllVariablesService(itemMutationService);
    }

    /// <summary>
    /// One universal response, reused for every request in the mixed-outcome test below:
    /// <c>ALREADY</c> is tracked in the manifest with a plain (reference-free) formula whose
    /// resolved value already matches its own current stored value (also present in this same
    /// response's variable list) — an already-current, skip outcome. <c>WILLSYNC</c> is tracked with
    /// a different plain formula that has no matching current-value entry — a stale, write outcome.
    /// Neither formula contains a <c>$(NAME)</c> reference, so resolution never actually depends on
    /// the lookup's contents beyond these two fixed entries — deterministic regardless of which
    /// copy of this response lands on which request.
    /// </summary>
    private const string UniversalResponseJson = """
        {"total_count":2,"variables":[
          {"name":"__GHVM_COMPOSITE_MANIFEST__","value":"{\"ALREADY\":\"literal-value\",\"WILLSYNC\":\"other-literal\"}","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},
          {"name":"ALREADY","value":"literal-value","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}
        ]}
        """;

    [Fact]
    public async Task SyncAllAsync_MixedTargets_ReportsEachOutcomeIndependently_OneBadTargetDoesNotFailTheOthers()
    {
        var handler = new FakeHttpMessageHandler();
        // ALREADY: manifest read + org lookup + repo lookup = 3 GETs, already current, no write.
        // WILLSYNC: manifest read + org lookup + repo lookup + PATCH = 4 requests, stale, writes.
        // GONE: manifest read = 1 GET, not tracked in the manifest, throws immediately.
        for (var i = 0; i < 8; i++) handler.Enqueue(HttpStatusCode.OK, UniversalResponseJson);
        var service = CreateService(handler);
        var targets = new[]
        {
            new SyncVariableRequest("octo-org", "widgets", null, "repository", "ALREADY"),
            new SyncVariableRequest("octo-org", "widgets", null, "repository", "WILLSYNC"),
            new SyncVariableRequest("octo-org", "widgets", null, "repository", "GONE"),
        };

        var results = await service.SyncAllAsync(targets);

        // Task.WhenAll preserves input order in its result array regardless of completion order,
        // so these can be asserted positionally even though the underlying requests interleaved.
        Assert.Equal(3, results.Count);

        var already = results[0];
        Assert.True(already.Ok);
        Assert.False(already.Synced);
        Assert.Equal("literal-value", already.ResolvedValue);
        Assert.Null(already.Message);

        var willSync = results[1];
        Assert.True(willSync.Ok);
        Assert.True(willSync.Synced);
        Assert.Equal("other-literal", willSync.ResolvedValue);
        Assert.Null(willSync.Message);

        var gone = results[2];
        Assert.False(gone.Ok);
        Assert.False(gone.Synced);
        Assert.Null(gone.ResolvedValue);
        Assert.Contains("no saved formula", gone.Message);

        Assert.Equal(8, handler.RequestedPaths.Count);
        Assert.Equal(1, handler.RequestedMethods.Count(m => m == HttpMethod.Patch));
    }

    [Fact]
    public async Task SyncAllAsync_CircularTarget_ReportsOkFalse_WithoutThrowing()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"__GHVM_COMPOSITE_MANIFEST__","value":"{\"SELF\":\"$(SELF)\"}","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""") // manifest read
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""") // organization lookup
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}"""); // repository lookup
        var service = CreateService(handler);
        var targets = new[] { new SyncVariableRequest("octo-org", "widgets", null, "repository", "SELF") };

        var results = await service.SyncAllAsync(targets);

        var result = Assert.Single(results);
        Assert.False(result.Ok);
        Assert.Contains("Circular reference", result.Message);
    }

    [Fact]
    public async Task SyncAllAsync_LockedScope_ReportsOkFalse_WithGitHubMessage()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);
        var targets = new[] { new SyncVariableRequest("octo-org", "widgets", "staging", "environment", "CDN") };

        var results = await service.SyncAllAsync(targets);

        var result = Assert.Single(results);
        Assert.False(result.Ok);
        Assert.Contains("Forbidden", result.Message);
    }
}
