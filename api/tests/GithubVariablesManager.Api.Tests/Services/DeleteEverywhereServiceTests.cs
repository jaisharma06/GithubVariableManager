using System.Net;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

/// <summary>
/// <see cref="DeleteEverywhereService.DeleteAsync"/> fans out over targets with
/// <see cref="Task.WhenAll"/> — a genuinely concurrent consumer of <see cref="FakeHttpMessageHandler"/>,
/// same category as <c>WorkflowRunCleanupServiceTests</c>. <c>DeleteSecretAsync</c> is still a single
/// request per target. <c>DeleteVariableAsync</c> is now a DELETE followed by a best-effort manifest
/// cleanup read (<see cref="ItemMutationService.DeleteVariableAsync"/>'s manifest step, which
/// silently swallows its own failures) — the "all succeed" tests below script an identical,
/// always-200 response for every request regardless of shape (DELETE or the manifest GET), so a
/// response landing on the "wrong" step never changes the outcome, avoiding any dependency on
/// dequeue order under concurrency. The "one target fails" case is deliberately tested with a single
/// target in isolation instead of racing a failure into a multi-target pool: since a manifest-step
/// failure is silently swallowed (never turns into a reported per-target failure), a single injected
/// non-2xx response landing on the "wrong" (manifest-read) request under concurrency would
/// non-deterministically produce zero reported failures instead of one — this test avoids that by
/// removing the race entirely, while <see cref="DeleteAsync_VariableKind_AllTargetsSucceed_ReturnsAllOkTrue"/>
/// already covers multi-target concurrent aggregation.
/// </summary>
public class DeleteEverywhereServiceTests
{
    private static DeleteEverywhereService CreateService(FakeHttpMessageHandler handler)
    {
        var actionsRestClient = new ActionsRestClient(new FakeGitHubClientFactory(handler));
        return new DeleteEverywhereService(new ItemMutationService(actionsRestClient, new SecretSealingService(), new CompositeVariableResolver(actionsRestClient), new CompositeManifestService(actionsRestClient)));
    }

    /// <summary>Valid, parseable as either a DELETE's ignored body or a manifest-read's variable list — an empty manifest, so the manifest step's diff never triggers a follow-up write.</summary>
    private const string EmptyVariableListJson = """{"total_count":0,"variables":[]}""";

    [Fact]
    public async Task DeleteAsync_VariableKind_AllTargetsSucceed_ReturnsAllOkTrue()
    {
        var handler = new FakeHttpMessageHandler();
        for (var i = 0; i < 6; i++) handler.Enqueue(HttpStatusCode.OK, EmptyVariableListJson); // 3 targets x (delete + best-effort manifest read)
        var service = CreateService(handler);
        var targets = new[]
        {
            new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "gadgets", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "gizmos", null, "repository"),
        };

        var results = await service.DeleteAsync("variable", "GONE", targets);

        Assert.Equal(3, results.Count);
        Assert.All(results, r => Assert.True(r.Ok));
        Assert.All(results, r => Assert.Null(r.Message));
        Assert.Equal(6, handler.RequestedPaths.Count);
        Assert.Equal(3, handler.RequestedMethods.Count(m => m == HttpMethod.Delete));
        Assert.Equal(3, handler.RequestedMethods.Count(m => m == HttpMethod.Get));
    }

    [Fact]
    public async Task DeleteAsync_VariableKind_SingleTargetFails_ReportsOkFalse_WithGitHubMessage_NeverAttemptsManifestCleanup()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);
        var targets = new[] { new LedgerScopeTargetRequest("octo-org", "widgets", "staging", "environment") };

        var results = await service.DeleteAsync("variable", "GONE", targets);

        var result = Assert.Single(results);
        Assert.False(result.Ok);
        Assert.Contains("Forbidden", result.Message);
        // The delete itself failed — DeleteVariableAsync never reaches its best-effort manifest step.
        Assert.Single(handler.RequestedPaths);
    }

    [Fact]
    public async Task DeleteAsync_SecretKind_AllTargetsSucceed_ReturnsAllOkTrue()
    {
        var handler = new FakeHttpMessageHandler();
        for (var i = 0; i < 2; i++) handler.Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);
        var targets = new[]
        {
            new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "gadgets", null, "repository"),
        };

        var results = await service.DeleteAsync("secret", "TOKEN", targets);

        Assert.Equal(2, results.Count);
        Assert.All(results, r => Assert.True(r.Ok));
        Assert.Equal(2, handler.RequestedPaths.Count);
        Assert.All(handler.RequestedMethods, m => Assert.Equal(HttpMethod.Delete, m));
    }

    [Fact]
    public async Task DeleteAsync_SecretKind_SingleLockedTarget_ReportsOkFalse_WithGitHubMessage()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);
        var targets = new[] { new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository") };

        var results = await service.DeleteAsync("secret", "TOKEN", targets);

        var result = Assert.Single(results);
        Assert.False(result.Ok);
        Assert.Contains("Forbidden", result.Message);
    }
}
