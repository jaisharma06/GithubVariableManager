using System.Net;
using System.Text;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;
using Sodium;

namespace GithubVariablesManager.Api.Tests.Services;

public class ItemMutationServiceTests
{
    private static ItemMutationService CreateService(FakeHttpMessageHandler handler)
    {
        var actionsRestClient = new ActionsRestClient(new FakeGitHubClientFactory(handler));
        return new ItemMutationService(actionsRestClient, new SecretSealingService(), new CompositeVariableResolver(actionsRestClient));
    }

    [Fact]
    public async Task CreateVariableAsync_PostsToTheLevelCollectionPath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Created, "{}");
        var service = CreateService(handler);

        await service.CreateVariableAsync("octo-org", "widgets", null, "repository", "NEW_VAR", "hello");

        Assert.Equal(HttpMethod.Post, handler.RequestedMethods[0]);
        Assert.StartsWith("/repos/octo-org/widgets/actions/variables", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task UpsertVariableAsync_NotFound_CreatesTheVariable()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.Created, "{}");
        var service = CreateService(handler);

        await service.UpsertVariableAsync("octo-org", "widgets", null, "repository", "NEW_VAR", "hello");

        Assert.Equal(HttpMethod.Get, handler.RequestedMethods[0]);
        Assert.Equal(HttpMethod.Post, handler.RequestedMethods[1]);
    }

    [Fact]
    public async Task UpsertVariableAsync_AlreadyExists_UpdatesInPlaceWithoutRenaming()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"name":"EXISTING","value":"old","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        await service.UpsertVariableAsync("octo-org", "widgets", null, "repository", "EXISTING", "new-value");

        Assert.Equal(HttpMethod.Get, handler.RequestedMethods[0]);
        Assert.Equal(HttpMethod.Patch, handler.RequestedMethods[1]);
        Assert.EndsWith("/EXISTING", handler.RequestedPaths[1]);
    }

    [Fact]
    public async Task UpdateVariableAsync_PatchesTheCurrentNamePath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        await service.UpdateVariableAsync("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value");

        Assert.Equal(HttpMethod.Patch, handler.RequestedMethods[0]);
        Assert.EndsWith("/OLD_NAME", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteVariableAsync_DeletesTheNamePath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        await service.DeleteVariableAsync("octo-org", "widgets", null, "repository", "GONE");

        Assert.Equal(HttpMethod.Delete, handler.RequestedMethods[0]);
        Assert.EndsWith("/GONE", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task CreateVariableAsync_DirectSelfReference_ThrowsCircularReferenceException_WithoutCallingGitHub()
    {
        // Repository level -> BuildLookupAsync fetches organization then repository variables.
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""");
        var service = CreateService(handler);

        await Assert.ThrowsAsync<CompositeCircularReferenceException>(() =>
            service.CreateVariableAsync("octo-org", "widgets", null, "repository", "SELF", "$(SELF)"));

        // Only the two lookup-building GETs happened — the actual create POST never fired.
        Assert.Equal(2, handler.RequestedPaths.Count);
        Assert.All(handler.RequestedMethods, m => Assert.Equal(HttpMethod.Get, m));
    }

    [Fact]
    public async Task CreateVariableAsync_IndirectCycle_ThrowsCircularReferenceException()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"B","value":"$(NEW_VAR)","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""");
        var service = CreateService(handler);

        await Assert.ThrowsAsync<CompositeCircularReferenceException>(() =>
            service.CreateVariableAsync("octo-org", "widgets", null, "repository", "NEW_VAR", "$(B)"));
    }

    [Fact]
    public async Task CreateVariableAsync_ForwardReferenceToMissingName_SavesFine_NotBlocked()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""") // organization lookup
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""") // repository lookup
            .Enqueue(HttpStatusCode.Created, "{}");
        var service = CreateService(handler);

        await service.CreateVariableAsync("octo-org", "widgets", null, "repository", "CDN", "$(NOT_YET_CREATED)/cdn");

        Assert.Equal(HttpMethod.Post, handler.RequestedMethods[2]);
    }

    [Fact]
    public async Task CreateVariableAsync_PlainNonCompositeValue_SkipsLookupEntirely()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Created, "{}");
        var service = CreateService(handler);

        await service.CreateVariableAsync("octo-org", "widgets", null, "repository", "PLAIN", "just-a-value");

        // No GET for a lookup — the only request is the create itself.
        Assert.Single(handler.RequestedPaths);
        Assert.Equal(HttpMethod.Post, handler.RequestedMethods[0]);
    }

    [Fact]
    public async Task UpdateVariableAsync_RenamedIntoASelfReference_ThrowsCircularReferenceException()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""") // organization lookup
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}"""); // repository lookup
        var service = CreateService(handler);

        await Assert.ThrowsAsync<CompositeCircularReferenceException>(() =>
            service.UpdateVariableAsync("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "$(NEW_NAME)"));
    }

    [Fact]
    public async Task DeleteVariableAsync_LockedScope_PropagatesApiExceptionUncaught()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);

        await Assert.ThrowsAsync<Octokit.ForbiddenException>(() =>
            service.DeleteVariableAsync("octo-org", "widgets", null, "repository", "SECRET_NAME"));
    }

    [Fact]
    public async Task PutSecretAsync_SealsAgainstTheFetchedPublicKey_ThenPuts()
    {
        var keyPair = PublicKeyBox.GenerateKeyPair();
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{Convert.ToBase64String(keyPair.PublicKey)}}"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        await service.PutSecretAsync("octo-org", "widgets", null, "repository", "TOKEN", "my-plaintext-value", null, null);

        Assert.Equal(HttpMethod.Get, handler.RequestedMethods[0]);
        Assert.Equal(HttpMethod.Put, handler.RequestedMethods[1]);
        using var body = System.Text.Json.JsonDocument.Parse(handler.RequestedBodies[1]!);
        var encryptedValueBase64 = body.RootElement.GetProperty("encrypted_value").GetString()!;
        var opened = SealedPublicKeyBox.Open(Convert.FromBase64String(encryptedValueBase64), keyPair.PrivateKey, keyPair.PublicKey);
        Assert.Equal("my-plaintext-value", Encoding.UTF8.GetString(opened));
    }

    [Fact]
    public async Task RenameSecretAsync_BothStepsSucceed_ReturnsDeleteSucceededTrue()
    {
        var keyPair = PublicKeyBox.GenerateKeyPair();
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{Convert.ToBase64String(keyPair.PublicKey)}}"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        var result = await service.RenameSecretAsync("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value", null, null);

        Assert.True(result.DeleteSucceeded);
        Assert.Null(result.DeleteError);
        Assert.Equal(3, handler.RequestedPaths.Count);
        Assert.EndsWith("/NEW_NAME", handler.RequestedPaths[1]);
        Assert.EndsWith("/OLD_NAME", handler.RequestedPaths[2]);
    }

    [Fact]
    public async Task RenameSecretAsync_DeleteStepFails_ReturnsDeleteSucceededFalse_WithoutThrowing()
    {
        var keyPair = PublicKeyBox.GenerateKeyPair();
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{Convert.ToBase64String(keyPair.PublicKey)}}"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);

        var result = await service.RenameSecretAsync("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value", null, null);

        Assert.False(result.DeleteSucceeded);
        Assert.Contains("Forbidden", result.DeleteError);
        Assert.Equal(3, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task RenameSecretAsync_PutStepFails_PropagatesApiExceptionUncaught_AndNeverAttemptsDelete()
    {
        var keyPair = PublicKeyBox.GenerateKeyPair();
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{Convert.ToBase64String(keyPair.PublicKey)}}"}""")
            .Enqueue(HttpStatusCode.UnprocessableEntity, """{"message":"Invalid request"}""");
        var service = CreateService(handler);

        // 422 responses deserialize into Octokit's more specific ApiValidationException (still an
        // Octokit.ApiException, still handled uncaught by the same global exception handler).
        await Assert.ThrowsAsync<Octokit.ApiValidationException>(() =>
            service.RenameSecretAsync("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value", null, null));

        Assert.Equal(2, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task DeleteSecretAsync_DeletesTheNamePath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        await service.DeleteSecretAsync("octo-org", "widgets", null, "repository", "GONE");

        Assert.Equal(HttpMethod.Delete, handler.RequestedMethods[0]);
        Assert.EndsWith("/GONE", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteSecretAsync_LockedScope_PropagatesApiExceptionUncaught()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);

        await Assert.ThrowsAsync<Octokit.ForbiddenException>(() =>
            service.DeleteSecretAsync("octo-org", "widgets", null, "repository", "SECRET_NAME"));
    }
}
