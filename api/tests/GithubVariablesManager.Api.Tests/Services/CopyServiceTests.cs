using System.Net;
using System.Text;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;
using Sodium;

namespace GithubVariablesManager.Api.Tests.Services;

/// <summary>
/// <see cref="CopyService.CopyAsync"/> fans out over targets with <see cref="Task.WhenAll"/> — a
/// genuinely concurrent consumer of <see cref="FakeHttpMessageHandler"/>, same category as
/// <c>WorkflowRunCleanupServiceTests</c>. The variable-kind tests below deliberately avoid asserting
/// on which specific target received which response: <see cref="FakeHttpMessageHandler"/>'s response
/// queue is dequeue-order, not target-order, under concurrency, and <c>UpsertVariableAsync</c> issues
/// 2 requests per target (a GET-then-decide, then a create-or-update write), so a response landing on
/// the "wrong" request shape could change GET-vs-PATCH branching. To stay deterministic regardless of
/// interleaving: the "all succeed" test scripts every single response identically (a 200 an existing
/// variable, safe for either a GET or a write to consume — never throws), and the "one target fails"
/// test scripts exactly one 403 among otherwise-identical 200s, so whichever single request draws it
/// (regardless of target or step) fails that one target only, isolated per
/// <see cref="Octokit.ApiException"/>-per-target design — the aggregate Ok:true/Ok:false counts are
/// deterministic even though which target failed is not.
/// </summary>
public class CopyServiceTests
{
    private static CopyService CreateService(FakeHttpMessageHandler handler)
    {
        var actionsRestClient = new ActionsRestClient(new FakeGitHubClientFactory(handler));
        return new CopyService(new ItemMutationService(actionsRestClient, new SecretSealingService()));
    }

    private const string ExistingVariableJson =
        """{"name":"NAME","value":"old","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}""";

    [Fact]
    public async Task CopyAsync_VariableKind_AllTargetsSucceed_ReturnsAllOkTrue_WithGetThenWritePerTarget()
    {
        var handler = new FakeHttpMessageHandler();
        for (var i = 0; i < 4; i++) handler.Enqueue(HttpStatusCode.OK, ExistingVariableJson); // 2 targets x (GET + write)
        var service = CreateService(handler);
        var targets = new[]
        {
            new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "gadgets", null, "repository"),
        };

        var results = await service.CopyAsync("variable", "NAME", "new-value", null, null, targets);

        Assert.Equal(2, results.Count);
        Assert.All(results, r => Assert.True(r.Ok));
        Assert.All(results, r => Assert.Null(r.Message));
        Assert.Equal(4, handler.RequestedPaths.Count);
        Assert.Equal(2, handler.RequestedMethods.Count(m => m == HttpMethod.Get));
        Assert.Equal(2, handler.RequestedMethods.Count(m => m == HttpMethod.Patch));
    }

    [Fact]
    public async Task CopyAsync_VariableKind_OneTargetFails_OthersSucceed_ReportsPerTargetIsolation()
    {
        var handler = new FakeHttpMessageHandler();
        for (var i = 0; i < 5; i++) handler.Enqueue(HttpStatusCode.OK, ExistingVariableJson);
        handler.Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}"""); // exactly one 403 among 6 total requests
        var service = CreateService(handler);
        var targets = new[]
        {
            new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "gadgets", null, "repository"),
            new LedgerScopeTargetRequest("octo-org", "gizmos", null, "repository"),
        };

        var results = await service.CopyAsync("variable", "NAME", "new-value", null, null, targets);

        Assert.Equal(3, results.Count);
        Assert.Equal(2, results.Count(r => r.Ok));
        var failure = Assert.Single(results, r => !r.Ok);
        Assert.Contains("Forbidden", failure.Message);
        Assert.Equal(6, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task CopyAsync_SecretKind_FetchesPublicKeySealsAndPuts_PassesVisibilityAndSelectedRepositoryIdsThrough()
    {
        var keyPair = PublicKeyBox.GenerateKeyPair();
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{Convert.ToBase64String(keyPair.PublicKey)}}"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);
        // visibility/selected_repository_ids are only meaningful (and only sent) at organization
        // level — mirrors ActionsRestClient.PutSecretAsync's own level branching.
        var targets = new[] { new LedgerScopeTargetRequest("octo-org", null, null, "organization") };

        var results = await service.CopyAsync("secret", "TOKEN", "my-plaintext-value", "selected", [1, 2, 3], targets);

        var result = Assert.Single(results);
        Assert.True(result.Ok);
        Assert.Null(result.Message);
        Assert.Equal(HttpMethod.Get, handler.RequestedMethods[0]);
        Assert.Equal(HttpMethod.Put, handler.RequestedMethods[1]);

        using var body = System.Text.Json.JsonDocument.Parse(handler.RequestedBodies[1]!);
        Assert.Equal("selected", body.RootElement.GetProperty("visibility").GetString());
        var repoIds = body.RootElement.GetProperty("selected_repository_ids").EnumerateArray().Select(e => e.GetInt32()).ToList();
        Assert.Equal([1, 2, 3], repoIds);
        var encryptedValueBase64 = body.RootElement.GetProperty("encrypted_value").GetString()!;
        var opened = SealedPublicKeyBox.Open(Convert.FromBase64String(encryptedValueBase64), keyPair.PrivateKey, keyPair.PublicKey);
        Assert.Equal("my-plaintext-value", Encoding.UTF8.GetString(opened));
    }

    [Fact]
    public async Task CopyAsync_VariableKind_SingleLockedTarget_ReportsOkFalse_WithGitHubMessage()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);
        var targets = new[] { new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository") };

        var results = await service.CopyAsync("variable", "NAME", "value", null, null, targets);

        var result = Assert.Single(results);
        Assert.False(result.Ok);
        Assert.Contains("Forbidden", result.Message);
        Assert.Equal("octo-org", result.Target.Org);
        Assert.Equal("widgets", result.Target.Repo);
    }
}
