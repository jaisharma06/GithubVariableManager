using System.Net;
using GithubVariablesManager.Api.GitHub;
using Octokit;
using Octokit.Internal;

namespace GithubVariablesManager.Api.Tests.GitHub;

public class ActionsRestClientTests
{
    private static ActionsRestClient CreateClient(FakeHttpMessageHandler handler) =>
        new(new FakeGitHubClientFactory(handler));

    [Fact]
    public async Task ListVariablesAsync_OrganizationLevel_UsesOrgPath_AndPaginatesUntilTotalCountReached()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":2,"variables":[{"name":"A","value":"1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":2,"variables":[{"name":"B","value":"2","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""");
        var client = CreateClient(handler);

        var variables = await client.ListVariablesAsync("octo-org", null, null, "organization");

        Assert.Equal(["A", "B"], variables.Select(v => v.Name));
        Assert.Equal(2, handler.RequestedPaths.Count);
        Assert.StartsWith("/orgs/octo-org/actions/variables", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task ListVariablesAsync_RepositoryLevel_UsesRepoPath_AndStopsAfterOnePage()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"A","value":"1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""");
        var client = CreateClient(handler);

        var variables = await client.ListVariablesAsync("octo-org", "widgets", null, "repository");

        Assert.Single(variables);
        Assert.Single(handler.RequestedPaths);
        Assert.StartsWith("/repos/octo-org/widgets/actions/variables", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task ListVariablesAsync_EnvironmentLevel_UsesEnvironmentPath()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""");
        var client = CreateClient(handler);

        var variables = await client.ListVariablesAsync("octo-org", "widgets", "staging", "environment");

        Assert.Empty(variables);
        Assert.StartsWith("/repos/octo-org/widgets/environments/staging/variables", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task ListVariablesAsync_EmptyPage_StopsEvenIfTotalCountNotReached()
    {
        // Mirrors GithubPagination.ts's Paginate: an empty items page always stops the loop, even
        // if the server-reported total count implies more should exist.
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":5,"variables":[]}""");
        var client = CreateClient(handler);

        var variables = await client.ListVariablesAsync("octo-org", null, null, "organization");

        Assert.Empty(variables);
        Assert.Single(handler.RequestedPaths);
    }

    [Fact]
    public async Task ListSecretsAsync_MapsMetadataOnly_NoValueField()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"secrets":[{"name":"TOKEN","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z","visibility":"all"}]}""");
        var client = CreateClient(handler);

        var secrets = await client.ListSecretsAsync("octo-org", null, null, "organization");

        var secret = Assert.Single(secrets);
        Assert.Equal("TOKEN", secret.Name);
        Assert.Equal("all", secret.Visibility);
        Assert.StartsWith("/orgs/octo-org/actions/secrets", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task ListEnvironmentsAsync_SinglePage_NeverPaginates()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"environments":[{"id":1,"name":"staging"}]}""");
        var client = CreateClient(handler);

        var environments = await client.ListEnvironmentsAsync("octo-org", "widgets");

        var env = Assert.Single(environments);
        Assert.Equal("staging", env.Name);
        Assert.Single(handler.RequestedPaths);
        Assert.StartsWith("/repos/octo-org/widgets/environments", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task ListEnvironmentsAsync_IdBeyondInt32Range_DoesNotOverflow()
    {
        // Regression test: GitHub's real environment ids are 64-bit and can exceed
        // Int32.MaxValue (2,147,483,647). RawEnvironment.Id used to be declared `int`, which made
        // Octokit's PocoJsonSerializerStrategy throw OverflowException converting a real id like
        // this one — reproduced live against org/repo Avyaan-Studios/AvyaanStudiosWebsite.
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"environments":[{"id":9876543210,"name":"production"}]}""");
        var client = CreateClient(handler);

        var environments = await client.ListEnvironmentsAsync("octo-org", "widgets");

        var env = Assert.Single(environments);
        Assert.Equal("production", env.Name);
        Assert.Equal(9876543210L, env.Id);
    }

    [Fact]
    public async Task CreateVariableAsync_PostsNameAndValue_ToTheCorrectPath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Created, "{}");
        var client = CreateClient(handler);

        await client.CreateVariableAsync("octo-org", "widgets", null, "repository", "NEW_VAR", "hello");

        Assert.StartsWith("/repos/octo-org/widgets/actions/variables", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task UpsertVariableAsync_WhenVariableDoesNotExist_Creates()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.Created, "{}");
        var client = CreateClient(handler);

        await client.UpsertVariableAsync("octo-org", "widgets", null, "repository", "NEW_VAR", "hello");

        Assert.Equal(2, handler.RequestedPaths.Count);
        Assert.EndsWith("/NEW_VAR", handler.RequestedPaths[0]);
        Assert.StartsWith("/repos/octo-org/widgets/actions/variables", handler.RequestedPaths[1]);
    }

    [Fact]
    public async Task UpsertVariableAsync_WhenVariableAlreadyExists_UpdatesInPlace()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"name":"EXISTING","value":"old","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.UpsertVariableAsync("octo-org", "widgets", null, "repository", "EXISTING", "new-value");

        Assert.Equal(2, handler.RequestedPaths.Count);
        Assert.EndsWith("/EXISTING", handler.RequestedPaths[0]);
        Assert.EndsWith("/EXISTING", handler.RequestedPaths[1]);
    }

    [Fact]
    public async Task UpdateVariableAsync_PatchesCurrentNamePath_WithNewNameAndValueInBody()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.UpdateVariableAsync("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value");

        Assert.EndsWith("/OLD_NAME", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteVariableAsync_DeletesTheCorrectPath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.DeleteVariableAsync("octo-org", "widgets", null, "repository", "GONE");

        Assert.EndsWith("/GONE", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task GetPublicKeyAsync_UsesThePublicKeyPath()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"key_id":"key-1","key":"abc123"}""");
        var client = CreateClient(handler);

        var publicKey = await client.GetPublicKeyAsync("octo-org", "widgets", null, "repository");

        Assert.Equal("key-1", publicKey.KeyId);
        Assert.Equal("abc123", publicKey.Key);
        Assert.Equal("/repos/octo-org/widgets/actions/secrets/public-key", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task PutSecretAsync_OrganizationLevel_DefaultsVisibilityToAll()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.PutSecretAsync("octo-org", null, null, "organization", "TOKEN", "sealed-value", "key-1", null, null);

        Assert.EndsWith("/TOKEN", handler.RequestedPaths[0]);
        Assert.Contains("\"visibility\":\"all\"", handler.RequestedBodies[0]);
        Assert.DoesNotContain("selected_repository_ids", handler.RequestedBodies[0]);
    }

    [Fact]
    public async Task PutSecretAsync_OrganizationLevel_SelectedVisibility_IncludesSelectedRepositoryIds()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.PutSecretAsync("octo-org", null, null, "organization", "TOKEN", "sealed-value", "key-1", "selected", [1, 2, 3]);

        Assert.Contains("\"visibility\":\"selected\"", handler.RequestedBodies[0]);
        Assert.Contains("\"selected_repository_ids\":[1,2,3]", handler.RequestedBodies[0]);
    }

    [Fact]
    public async Task PutSecretAsync_OrganizationLevel_SelectedVisibility_AcceptsRepositoryIdBeyondInt32Range()
    {
        // GitHub repo ids are 64-bit, same as environment ids (see EnvironmentsServiceTests's
        // ListEnvironmentsAsync_MapsRawEnvironments_WithIdBeyondInt32Range regression test for the
        // OverflowException that field type previously caused) — SelectedRepositoryIds must be
        // `long`, not `int`, to accept ids beyond Int32.MaxValue (2,147,483,647).
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.PutSecretAsync("octo-org", null, null, "organization", "TOKEN", "sealed-value", "key-1", "selected", [9876543210]);

        Assert.Contains("\"selected_repository_ids\":[9876543210]", handler.RequestedBodies[0]);
    }

    [Fact]
    public async Task PutSecretAsync_RepositoryLevel_NeverIncludesVisibilityFields()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.PutSecretAsync("octo-org", "widgets", null, "repository", "TOKEN", "sealed-value", "key-1", "selected", [1, 2, 3]);

        Assert.DoesNotContain("visibility", handler.RequestedBodies[0]);
        Assert.DoesNotContain("selected_repository_ids", handler.RequestedBodies[0]);
    }

    [Fact]
    public async Task PutSecretAsync_EnvironmentLevel_NeverIncludesVisibilityFields()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.PutSecretAsync("octo-org", "widgets", "staging", "environment", "TOKEN", "sealed-value", "key-1", null, null);

        Assert.DoesNotContain("visibility", handler.RequestedBodies[0]);
        Assert.StartsWith("/repos/octo-org/widgets/environments/staging/secrets", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteSecretAsync_DeletesTheCorrectPath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.DeleteSecretAsync("octo-org", "widgets", null, "repository", "GONE");

        Assert.EndsWith("/GONE", handler.RequestedPaths[0]);
        Assert.StartsWith("/repos/octo-org/widgets/actions/secrets", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task CreateEnvironmentAsync_PutsTheEnvironmentPath_WithEmptyBody()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.CreateEnvironmentAsync("octo-org", "widgets", "staging");

        Assert.Equal(HttpMethod.Put, handler.RequestedMethods[0]);
        Assert.EndsWith("/repos/octo-org/widgets/environments/staging", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteEnvironmentAsync_DeletesTheEnvironmentPath()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = CreateClient(handler);

        await client.DeleteEnvironmentAsync("octo-org", "widgets", "staging");

        Assert.Equal(HttpMethod.Delete, handler.RequestedMethods[0]);
        Assert.EndsWith("/repos/octo-org/widgets/environments/staging", handler.RequestedPaths[0]);
    }
}
