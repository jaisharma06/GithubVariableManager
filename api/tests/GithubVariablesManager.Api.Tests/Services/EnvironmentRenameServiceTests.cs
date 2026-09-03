using System.Net;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

public class EnvironmentRenameServiceTests
{
    private static EnvironmentRenameService CreateService(FakeHttpMessageHandler handler)
    {
        var actionsRestClient = new ActionsRestClient(new FakeGitHubClientFactory(handler));
        return new EnvironmentRenameService(
            new EnvironmentsService(actionsRestClient),
            actionsRestClient,
            new ItemMutationService(actionsRestClient, new SecretSealingService(), new CompositeVariableResolver(actionsRestClient), new CompositeManifestService(actionsRestClient)));
    }

    [Fact]
    public async Task RenameEnvironmentAsync_InvalidNewName_ThrowsValidationException_BeforeAnyMutatingCall()
    {
        var handler = new FakeHttpMessageHandler();
        var service = CreateService(handler);

        await Assert.ThrowsAsync<EnvironmentRenameValidationException>(() =>
            service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "bad name!", false));

        Assert.Empty(handler.RequestedPaths);
    }

    [Fact]
    public async Task RenameEnvironmentAsync_NameAlreadyExists_ThrowsValidationException()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"environments":[{"id":1,"name":"production"}]}""");
        var service = CreateService(handler);

        var ex = await Assert.ThrowsAsync<EnvironmentRenameValidationException>(() =>
            service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "production", false));

        Assert.Equal("An environment with this name already exists.", ex.Message);
        Assert.Single(handler.RequestedPaths);
    }

    [Fact]
    public async Task RenameEnvironmentAsync_AllVariablesCopySucceed_NoSecrets_DeletesOldEnvironment()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")     // existing-name check
            .Enqueue(HttpStatusCode.NoContent, "{}")                                    // create new environment
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"API_URL","value":"v1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""") // list old env's variables
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")            // upsert: exists check -> doesn't exist
            .Enqueue(HttpStatusCode.Created, "{}")                                      // upsert: create
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""")           // secrets-present check
            .Enqueue(HttpStatusCode.NoContent, "{}");                                   // delete old environment
        var service = CreateService(handler);

        var result = await service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "production", false);

        Assert.Null(result.ListVariablesError);
        Assert.Equal(1, result.VariablesCopied);
        Assert.Empty(result.VariableCopyFailures);
        Assert.True(result.OldEnvironmentDeleted);
        Assert.Null(result.OldEnvironmentDeleteError);
        Assert.Equal(7, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task RenameEnvironmentAsync_SomeVariableCopyFails_DoesNotDeleteOldEnvironment_EvenIfDeleteOldAnywayTrue()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.OK, """
                {"total_count":3,"variables":[
                  {"name":"VAR_1","value":"v1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},
                  {"name":"VAR_2","value":"v2","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},
                  {"name":"VAR_3","value":"v3","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}
                ]}
                """)
            // VAR_1: exists-check (404) then create (201) -> succeeds
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.Created, "{}")
            // VAR_2: exists-check (404) then create fails (422) -> failure
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.UnprocessableEntity, """{"message":"Invalid request"}""")
            // VAR_3: exists-check (404) then create (201) -> succeeds
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.Created, "{}");
        var service = CreateService(handler);

        // deleteOldAnyway: true — must still not delete, since a variable copy failed.
        var result = await service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "production", true);

        Assert.Equal(2, result.VariablesCopied);
        var failure = Assert.Single(result.VariableCopyFailures);
        Assert.Equal("VAR_2", failure.Name);
        Assert.False(result.OldEnvironmentDeleted);
        Assert.Null(result.OldEnvironmentDeleteError);
        // 1 (existing-check) + 1 (create env) + 1 (list variables) + 6 (3 variables x GET-then-write) — no secrets check, no delete.
        Assert.Equal(9, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task RenameEnvironmentAsync_ListVariablesFails_ReportsListVariablesError_DoesNotDeleteOldEnvironment()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);

        var result = await service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "production", false);

        Assert.NotNull(result.ListVariablesError);
        Assert.Contains("Forbidden", result.ListVariablesError);
        Assert.Equal(0, result.VariablesCopied);
        Assert.False(result.OldEnvironmentDeleted);
        Assert.Equal(3, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task RenameEnvironmentAsync_HasSecrets_DeleteOldAnywayFalse_SkipsDeletionWithoutError()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"secrets":[{"name":"TOKEN","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""");
        var service = CreateService(handler);

        var result = await service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "production", false);

        Assert.False(result.OldEnvironmentDeleted);
        Assert.Null(result.OldEnvironmentDeleteError);
        Assert.Equal(4, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task RenameEnvironmentAsync_HasSecrets_DeleteOldAnywayTrue_DeletesAnyway()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            // deleteOldAnyway short-circuits the secrets-present check entirely — no secrets list call.
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var service = CreateService(handler);

        var result = await service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "production", true);

        Assert.True(result.OldEnvironmentDeleted);
        Assert.Equal(4, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task RenameEnvironmentAsync_DeleteStepFails_ReportsOldEnvironmentDeleteError_WithoutThrowing()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""")
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);

        var result = await service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "production", false);

        Assert.False(result.OldEnvironmentDeleted);
        Assert.NotNull(result.OldEnvironmentDeleteError);
        Assert.Contains("Forbidden", result.OldEnvironmentDeleteError);
    }

    [Fact]
    public async Task RenameEnvironmentAsync_CreateStepFails_PropagatesApiExceptionUncaught()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);

        await Assert.ThrowsAsync<Octokit.ForbiddenException>(() =>
            service.RenameEnvironmentAsync("octo-org", "widgets", "staging", "production", false));

        Assert.Equal(2, handler.RequestedPaths.Count);
    }
}
