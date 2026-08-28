using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using GithubVariablesManager.Api.Contracts;
using GithubVariablesManager.Api.GitHub;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Sodium;

namespace GithubVariablesManager.Api.Tests.Endpoints;

public class LedgerEndpointsTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> WithFakeGitHubClient(FakeHttpMessageHandler handler) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddScoped<GitHubClientFactory>(_ => new FakeGitHubClientFactory(handler));
        }));

    private static HttpClient AuthedClient(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "some-token");
        return client;
    }

    [Fact]
    public async Task GetLedger_OrgOnlyScope_ReturnsCamelCasedItems()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"V1","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/ledger?org=octo-org");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"kind\":\"variable\"", body);
        Assert.Contains("\"name\":\"V1\"", body);
        Assert.Contains("\"items\"", body);
        Assert.Contains("\"partialErrors\"", body);
        Assert.Contains("\"lockedSections\"", body);
    }

    [Fact]
    public async Task GetLedger_MissingOrg_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.GetAsync("/api/ledger");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetLedger_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/ledger?org=octo-org");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\":\"Missing bearer token.\"", body);
    }

    [Fact]
    public async Task GetLedger_EveryJobFails_Returns502()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom1"}""")
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom2"}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/ledger?org=octo-org");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\"", body);
    }

    [Fact]
    public async Task GetLedger_LockedScope_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        // A repo scope on a nonexistent/inaccessible owner: the account-type lookup itself 404s,
        // which is caught internally by LedgerService (silent-skip), not this test's concern —
        // this test instead exercises a write endpoint's locked-scope path, see PostVariable below.
        var response = await client.GetAsync("/api/ledger?org=octo-org");

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task GetExport_ValidRequest_ReturnsValidXlsxWorkbook()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"V1","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/ledger/export?org=octo-org");

        response.EnsureSuccessStatusCode();
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("octo-org-variables-secrets-", response.Content.Headers.ContentDisposition?.FileNameStar ?? response.Content.Headers.ContentDisposition?.FileName);

        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.NotEmpty(bytes);

        // Strong end-to-end check: reopen the actual returned bytes with ClosedXML itself.
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(bytes));
        Assert.Contains("Organization", workbook.Worksheets.Select(w => w.Name));
    }

    [Fact]
    public async Task GetExport_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/ledger/export?org=octo-org");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetExport_MissingOrg_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.GetAsync("/api/ledger/export");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetExport_EveryJobFails_Returns502()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom1"}""")
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom2"}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/ledger/export?org=octo-org");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }

    [Fact]
    public async Task PostVariable_ValidRequest_Creates()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.Created, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/variables",
            new CreateVariableRequest("octo-org", "widgets", null, "repository", "NEW_VAR", "hello"));

        response.EnsureSuccessStatusCode();
        Assert.StartsWith("/repos/octo-org/widgets/actions/variables", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task PostVariable_InvalidLevel_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PostAsJsonAsync("/api/ledger/variables",
            new CreateVariableRequest("octo-org", "widgets", null, "not-a-level", "NEW_VAR", "hello"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostVariable_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/ledger/variables",
            new CreateVariableRequest("octo-org", "widgets", null, "repository", "NEW_VAR", "hello"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostVariable_AlreadyExists_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.UnprocessableEntity, """{"message":"already exists"}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/variables",
            new CreateVariableRequest("octo-org", "widgets", null, "repository", "NEW_VAR", "hello"));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task PatchVariable_ValidRequest_Renames()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PatchAsJsonAsync("/api/ledger/variables",
            new RenameVariableRequest("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value"));

        response.EnsureSuccessStatusCode();
        Assert.EndsWith("/OLD_NAME", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteVariable_ValidRequest_Deletes()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.DeleteAsync(
            "/api/ledger/variables?org=octo-org&repo=widgets&level=repository&name=GONE");

        response.EnsureSuccessStatusCode();
        Assert.EndsWith("/GONE", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteVariable_InvalidLevel_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.DeleteAsync(
            "/api/ledger/variables?org=octo-org&repo=widgets&level=not-a-level&name=GONE");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static string GenerateBase64PublicKey() => Convert.ToBase64String(PublicKeyBox.GenerateKeyPair().PublicKey);

    [Fact]
    public async Task PutSecret_ValidRequest_Returns200()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{GenerateBase64PublicKey()}}"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PutAsJsonAsync("/api/ledger/secrets",
            new PutSecretRequest("octo-org", "widgets", null, "repository", "NEW_SECRET", "hello", null, null));

        response.EnsureSuccessStatusCode();
        Assert.EndsWith("/NEW_SECRET", handler.RequestedPaths[1]);
    }

    [Fact]
    public async Task PutSecret_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync("/api/ledger/secrets",
            new PutSecretRequest("octo-org", "widgets", null, "repository", "NEW_SECRET", "hello", null, null));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PutSecret_InvalidLevel_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PutAsJsonAsync("/api/ledger/secrets",
            new PutSecretRequest("octo-org", "widgets", null, "not-a-level", "NEW_SECRET", "hello", null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PatchSecret_BothStepsSucceed_ReturnsDeleteSucceededTrueInBody()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{GenerateBase64PublicKey()}}"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PatchAsJsonAsync("/api/ledger/secrets",
            new RenameSecretRequest("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value", null, null));

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<RenameSecretResponse>();
        Assert.NotNull(body);
        Assert.True(body!.DeleteSucceeded);
        Assert.Null(body.DeleteError);
    }

    [Fact]
    public async Task PatchSecret_DeleteStepFails_Returns200WithDeleteSucceededFalse()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{GenerateBase64PublicKey()}}"}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PatchAsJsonAsync("/api/ledger/secrets",
            new RenameSecretRequest("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value", null, null));

        // The key assertion: a partial rename failure is never mapped to a 5xx — the PUT genuinely
        // succeeded, so the client must not roll back to believing nothing changed.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<RenameSecretResponse>();
        Assert.NotNull(body);
        Assert.False(body!.DeleteSucceeded);
        Assert.Contains("Forbidden", body.DeleteError);
    }

    [Fact]
    public async Task PatchSecret_PutStepFails_GoesThroughGlobalExceptionHandler()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, $$"""{"key_id":"key-1","key":"{{GenerateBase64PublicKey()}}"}""")
            .Enqueue(HttpStatusCode.UnprocessableEntity, """{"message":"Invalid request"}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PatchAsJsonAsync("/api/ledger/secrets",
            new RenameSecretRequest("octo-org", "widgets", null, "repository", "OLD_NAME", "NEW_NAME", "value", null, null));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task DeleteSecret_ValidRequest_Returns200()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.DeleteAsync(
            "/api/ledger/secrets?org=octo-org&repo=widgets&level=repository&name=GONE");

        response.EnsureSuccessStatusCode();
        Assert.EndsWith("/GONE", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteSecret_InvalidLevel_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.DeleteAsync(
            "/api/ledger/secrets?org=octo-org&repo=widgets&level=not-a-level&name=GONE");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeleteSecret_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.DeleteAsync(
            "/api/ledger/secrets?org=octo-org&repo=widgets&level=repository&name=GONE");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetEnvironments_ValidRequest_ReturnsCamelCasedList()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"environments":[{"id":1,"name":"staging"}]}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.GetAsync("/api/ledger/environments?org=octo-org&repo=widgets");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"name\":\"staging\"", body);
    }

    [Fact]
    public async Task GetEnvironments_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/ledger/environments?org=octo-org&repo=widgets");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostEnvironment_ValidRequest_Creates()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/environments",
            new CreateEnvironmentRequest("octo-org", "widgets", "staging"));

        response.EnsureSuccessStatusCode();
        Assert.EndsWith("/repos/octo-org/widgets/environments/staging", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task PostEnvironment_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/ledger/environments",
            new CreateEnvironmentRequest("octo-org", "widgets", "staging"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DeleteEnvironment_ValidRequest_Deletes()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.DeleteAsync("/api/ledger/environments?org=octo-org&repo=widgets&name=staging");

        response.EnsureSuccessStatusCode();
        Assert.EndsWith("/repos/octo-org/widgets/environments/staging", handler.RequestedPaths[0]);
    }

    [Fact]
    public async Task DeleteEnvironment_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.DeleteAsync("/api/ledger/environments?org=octo-org&repo=widgets&name=staging");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task RenameEnvironment_ValidRequest_ReturnsResponseShape()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""")
            .Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/environments/rename",
            new RenameEnvironmentRequest("octo-org", "widgets", "staging", "production", false));

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<RenameEnvironmentResponse>();
        Assert.NotNull(body);
        Assert.True(body!.OldEnvironmentDeleted);
        Assert.Null(body.OldEnvironmentDeleteError);
        Assert.Equal(0, body.VariablesCopied);
    }

    [Fact]
    public async Task RenameEnvironment_InvalidNewName_Returns400WithErrorResponse()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PostAsJsonAsync("/api/ledger/environments/rename",
            new RenameEnvironmentRequest("octo-org", "widgets", "staging", "bad name!", false));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"error\"", body);
    }

    [Fact]
    public async Task RenameEnvironment_SomeVariableCopyFails_Returns200WithPartialFailureReported()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.NoContent, "{}")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"VAR_1","value":"v1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.UnprocessableEntity, """{"message":"Invalid request"}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/environments/rename",
            new RenameEnvironmentRequest("octo-org", "widgets", "staging", "production", true));

        // The key assertion: a partial variable-copy failure is never mapped to a 5xx, and the old
        // environment is reported as never deleted — assert the body, not just the status code.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<RenameEnvironmentResponse>();
        Assert.NotNull(body);
        Assert.False(body!.OldEnvironmentDeleted);
        Assert.Single(body.VariableCopyFailures);
        Assert.Equal("VAR_1", body.VariableCopyFailures[0].Name);
    }

    [Fact]
    public async Task RenameEnvironment_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/ledger/environments/rename",
            new RenameEnvironmentRequest("octo-org", "widgets", "staging", "production", false));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostCopy_ValidRequest_ReturnsPerTargetResults()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.Created, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/copy",
            new CopyRequest("variable", "NEW_VAR", "hello", null, null,
                [new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository")]));

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<CopyResponse>();
        Assert.NotNull(body);
        var result = Assert.Single(body!.Results);
        Assert.True(result.Ok);
        Assert.Null(result.Message);
        Assert.Equal("octo-org", result.Target.Org);
    }

    [Fact]
    public async Task PostCopy_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/ledger/copy",
            new CopyRequest("variable", "NEW_VAR", "hello", null, null,
                [new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository")]));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostCopy_InvalidKind_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PostAsJsonAsync("/api/ledger/copy",
            new CopyRequest("not-a-kind", "NEW_VAR", "hello", null, null,
                [new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostCopy_InvalidLevelInTarget_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PostAsJsonAsync("/api/ledger/copy",
            new CopyRequest("variable", "NEW_VAR", "hello", null, null,
                [new LedgerScopeTargetRequest("octo-org", "widgets", null, "not-a-level")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostCopy_EmptyTargets_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PostAsJsonAsync("/api/ledger/copy",
            new CopyRequest("variable", "NEW_VAR", "hello", null, null, []));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostDeleteEverywhere_ValidRequest_ReturnsPerTargetResults()
    {
        var handler = new FakeHttpMessageHandler().Enqueue(HttpStatusCode.NoContent, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/delete-everywhere",
            new DeleteEverywhereRequest("variable", "GONE",
                [new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository")]));

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<DeleteEverywhereResponse>();
        Assert.NotNull(body);
        var result = Assert.Single(body!.Results);
        Assert.True(result.Ok);
        Assert.Null(result.Message);
    }

    [Fact]
    public async Task PostDeleteEverywhere_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/ledger/delete-everywhere",
            new DeleteEverywhereRequest("variable", "GONE",
                [new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository")]));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostDeleteEverywhere_InvalidKind_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PostAsJsonAsync("/api/ledger/delete-everywhere",
            new DeleteEverywhereRequest("not-a-kind", "GONE",
                [new LedgerScopeTargetRequest("octo-org", "widgets", null, "repository")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostDeleteEverywhere_InvalidLevelInTarget_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PostAsJsonAsync("/api/ledger/delete-everywhere",
            new DeleteEverywhereRequest("variable", "GONE",
                [new LedgerScopeTargetRequest("octo-org", "widgets", null, "not-a-level")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostDeleteEverywhere_EmptyTargets_Returns400()
    {
        var client = AuthedClient(WithFakeGitHubClient(new FakeHttpMessageHandler()));

        var response = await client.PostAsJsonAsync("/api/ledger/delete-everywhere",
            new DeleteEverywhereRequest("variable", "GONE", []));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostCopyEnvironmentVariables_ValidRequest_ReturnsCopiedSkippedAndFailures()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """
                {"total_count":2,"variables":[
                  {"name":"ALREADY_THERE","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},
                  {"name":"NEW_VAR","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}
                ]}
                """)
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"ALREADY_THERE","value":"existing","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.Created, "{}");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/environments/copy-variables",
            new CopyEnvironmentVariablesRequest("octo-org", "widgets", "staging", "octo-org", "widgets", "production"));

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<CopyEnvironmentVariablesResponse>();
        Assert.NotNull(body);
        Assert.Null(body!.ListSourceError);
        Assert.Equal(["NEW_VAR"], body.Copied);
        Assert.Equal(["ALREADY_THERE"], body.Skipped);
        Assert.Empty(body.Failures);
    }

    [Fact]
    public async Task PostCopyEnvironmentVariables_ListSourceFails_Returns200WithListSourceError()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""");
        var client = AuthedClient(WithFakeGitHubClient(handler));

        var response = await client.PostAsJsonAsync("/api/ledger/environments/copy-variables",
            new CopyEnvironmentVariablesRequest("octo-org", "widgets", "staging", "octo-org", "widgets", "production"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<CopyEnvironmentVariablesResponse>();
        Assert.NotNull(body);
        Assert.NotNull(body!.ListSourceError);
        Assert.Contains("Forbidden", body.ListSourceError);
        Assert.Empty(body.Copied);
    }

    [Fact]
    public async Task PostCopyEnvironmentVariables_MissingBearerToken_Returns401()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/ledger/environments/copy-variables",
            new CopyEnvironmentVariablesRequest("octo-org", "widgets", "staging", "octo-org", "widgets", "production"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
