using System.Net;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

/// <summary>
/// <see cref="DeleteEverywhereService.DeleteAsync"/> fans out over targets with
/// <see cref="Task.WhenAll"/> — a genuinely concurrent consumer of <see cref="FakeHttpMessageHandler"/>,
/// same category as <c>WorkflowRunCleanupServiceTests</c>. Unlike <c>CopyServiceTests</c>'
/// variable-kind case, <c>DeleteVariableAsync</c>/<c>DeleteSecretAsync</c> are each a single request
/// per target, so there's no GET-vs-write branching risk from a response landing on the "wrong" step
/// — the "one target fails" test below still avoids asserting on which specific target got which
/// outcome, matching <c>CopyServiceTests</c>' convention, since dequeue order still isn't
/// target-order under concurrency.
/// </summary>
public class DeleteEverywhereServiceTests
{
    private static DeleteEverywhereService CreateService(FakeHttpMessageHandler handler)
    {
        var actionsRestClient = new ActionsRestClient(new FakeGitHubClientFactory(handler));
        return new DeleteEverywhereService(new ItemMutationService(actionsRestClient, new SecretSealingService()));
    }

    [Fact]
    public async Task DeleteAsync_VariableKind_AllTargetsSucceed_ReturnsAllOkTrue()
    {
        var handler = new FakeHttpMessageHandler();
        for (var i = 0; i < 3; i++) handler.Enqueue(HttpStatusCode.NoContent, "{}");
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
        Assert.Equal(3, handler.RequestedPaths.Count);
        Assert.All(handler.RequestedMethods, m => Assert.Equal(HttpMethod.Delete, m));
    }

    [Fact]
    public async Task DeleteAsync_VariableKind_OneTargetFails_OthersSucceed_ReportsPerTargetIsolation()
    {
        var handler = new FakeHttpMessageHandler();
        for (var i = 0; i < 4; i++) handler.Enqueue(HttpStatusCode.NoContent, "{}");
        handler.Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);
        var targets = new[]
        {
            new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "gadgets", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "gizmos", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "doohickeys", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "widgets", "staging", "environment"),
        };

        var results = await service.DeleteAsync("variable", "GONE", targets);

        Assert.Equal(5, results.Count);
        Assert.Equal(4, results.Count(r => r.Ok));
        var failure = Assert.Single(results, r => !r.Ok);
        Assert.Contains("Forbidden", failure.Message);
        Assert.Equal(5, handler.RequestedPaths.Count);
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
