using System.Net;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

public class EnvironmentVariableCopyServiceTests
{
    private static EnvironmentVariableCopyService CreateService(FakeHttpMessageHandler handler)
    {
        var actionsRestClient = new ActionsRestClient(new FakeGitHubClientFactory(handler));
        return new EnvironmentVariableCopyService(actionsRestClient, new ItemMutationService(actionsRestClient, new SecretSealingService()));
    }

    [Fact]
    public async Task CopyEnvironmentVariablesAsync_ListSourceFails_ReportsListSourceError_DoesNothingElse()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var service = CreateService(handler);

        var result = await service.CopyEnvironmentVariablesAsync("octo-org", "widgets", "staging", "octo-org", "widgets", "production");

        Assert.NotNull(result.ListSourceError);
        Assert.Contains("Forbidden", result.ListSourceError);
        Assert.Empty(result.Copied);
        Assert.Empty(result.Skipped);
        Assert.Empty(result.Failures);
        Assert.Single(handler.RequestedPaths);
    }

    [Fact]
    public async Task CopyEnvironmentVariablesAsync_ListDestFails_ReportsListSourceError_DoesNothingElse()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")   // source list ok
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");     // dest list fails
        var service = CreateService(handler);

        var result = await service.CopyEnvironmentVariablesAsync("octo-org", "widgets", "staging", "octo-org", "widgets", "production");

        Assert.NotNull(result.ListSourceError);
        Assert.Contains("Forbidden", result.ListSourceError);
        Assert.Empty(result.Copied);
        Assert.Empty(result.Skipped);
        Assert.Empty(result.Failures);
        Assert.Equal(2, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task CopyEnvironmentVariablesAsync_SkipsNamesThatAlreadyExistAtDestination()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """
                {"total_count":2,"variables":[
                  {"name":"API_URL","value":"https://staging.example.com","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},
                  {"name":"NEW_VAR","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}
                ]}
                """) // source
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"API_URL","value":"already-here","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""") // dest — API_URL already exists
            .Enqueue(HttpStatusCode.Created, "{}"); // create NEW_VAR
        var service = CreateService(handler);

        var result = await service.CopyEnvironmentVariablesAsync("octo-org", "widgets", "staging", "octo-org", "widgets", "production");

        Assert.Null(result.ListSourceError);
        Assert.Equal(["NEW_VAR"], result.Copied);
        Assert.Equal(["API_URL"], result.Skipped);
        Assert.Empty(result.Failures);
        Assert.Equal(3, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task CopyEnvironmentVariablesAsync_ReplacesSourceEnvNameInValue_CaseSensitiveOrdinalSubstring()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"BASE_URL","value":"https://staging.example.com/staging/api","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.Created, "{}");
        var service = CreateService(handler);

        var result = await service.CopyEnvironmentVariablesAsync("octo-org", "widgets", "staging", "octo-org", "widgets", "production");

        Assert.Equal(["BASE_URL"], result.Copied);
        using var body = System.Text.Json.JsonDocument.Parse(handler.RequestedBodies[2]!);
        Assert.Equal("https://production.example.com/production/api", body.RootElement.GetProperty("value").GetString());
    }

    [Fact]
    public async Task CopyEnvironmentVariablesAsync_PerVariableCreateFailure_IsolatedToThatVariable_DoesNotAbortBatch()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """
                {"total_count":2,"variables":[
                  {"name":"VAR_1","value":"v1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},
                  {"name":"VAR_2","value":"v2","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}
                ]}
                """)
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.UnprocessableEntity, """{"message":"Invalid request"}""") // VAR_1 create fails
            .Enqueue(HttpStatusCode.Created, "{}"); // VAR_2 create succeeds
        var service = CreateService(handler);

        var result = await service.CopyEnvironmentVariablesAsync("octo-org", "widgets", "staging", "octo-org", "widgets", "production");

        Assert.Null(result.ListSourceError);
        Assert.Equal(["VAR_2"], result.Copied);
        Assert.Empty(result.Skipped);
        var failure = Assert.Single(result.Failures);
        Assert.Equal("VAR_1", failure.Name);
        Assert.Contains("Invalid request", failure.Error);
    }

    [Fact]
    public async Task CopyEnvironmentVariablesAsync_NoSourceVariables_ReturnsEmptyEverything_NoWrites()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""");
        var service = CreateService(handler);

        var result = await service.CopyEnvironmentVariablesAsync("octo-org", "widgets", "staging", "other-org", "gadgets", "production");

        Assert.Null(result.ListSourceError);
        Assert.Empty(result.Copied);
        Assert.Empty(result.Skipped);
        Assert.Empty(result.Failures);
        Assert.Equal(2, handler.RequestedPaths.Count);
    }
}
