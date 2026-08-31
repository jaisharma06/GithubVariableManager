using System.Net;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

public class LedgerServiceTests
{
    private static LedgerService CreateService(FakeHttpMessageHandler handler)
    {
        var factory = new FakeGitHubClientFactory(handler);
        var actionsRestClient = new ActionsRestClient(factory);
        var environmentsService = new EnvironmentsService(actionsRestClient);
        var scopesService = new ScopesService(factory);
        return new LedgerService(actionsRestClient, environmentsService, scopesService, new CompositeVariableResolver(actionsRestClient));
    }

    [Fact]
    public async Task GetLedgerAsync_OrgOnlyScope_FetchesOrgLevelVariablesAndSecretsOnly()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"V1","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"secrets":[{"name":"S1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z","visibility":"all"}]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", null);

        Assert.Equal(2, handler.RequestedPaths.Count);
        Assert.Equal(2, ledger.Items.Count);
        Assert.Contains(ledger.Items, i => i.Kind == "variable" && i.Level == "organization" && i.Name == "V1" && i.Value == "v");
        Assert.Contains(ledger.Items, i => i.Kind == "secret" && i.Level == "organization" && i.Name == "S1" && i.Visibility == "all" && i.Value == null);
        Assert.Empty(ledger.PartialErrors);
        Assert.Empty(ledger.LockedSections);
    }

    [Fact]
    public async Task GetLedgerAsync_RepoScope_OrganizationAccount_FansOutAcrossOrgRepoAndEveryEnvironment()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"login":"octo-org","type":"Organization"}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"environments":[{"id":1,"name":"staging"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", "widgets");

        Assert.Equal(8, handler.RequestedPaths.Count);
        Assert.Contains("/repos/octo-org/widgets/environments", handler.RequestedPaths[1]);
        Assert.StartsWith("/orgs/octo-org/actions/variables", handler.RequestedPaths[2]);
        Assert.StartsWith("/orgs/octo-org/actions/secrets", handler.RequestedPaths[3]);
        Assert.StartsWith("/repos/octo-org/widgets/actions/variables", handler.RequestedPaths[4]);
        Assert.StartsWith("/repos/octo-org/widgets/actions/secrets", handler.RequestedPaths[5]);
        Assert.StartsWith("/repos/octo-org/widgets/environments/staging/variables", handler.RequestedPaths[6]);
        Assert.StartsWith("/repos/octo-org/widgets/environments/staging/secrets", handler.RequestedPaths[7]);
    }

    [Fact]
    public async Task GetLedgerAsync_RepoScope_UserAccount_SkipsOrgLevelEntirely()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"login":"octocat","type":"User"}""")
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octocat", "dotfiles");

        Assert.Equal(4, handler.RequestedPaths.Count);
        Assert.DoesNotContain(ledger.Items, i => i.Level == "organization");
    }

    [Fact]
    public async Task GetLedgerAsync_RepoScope_AccountTypeCheckFails_SilentlySkipsOrgLevel_NotSurfacedAsAnError()
    {
        // Same silent-skip-on-failure behavior as today's Angular IsOrgAccountQuery — a failed
        // account-type check just means "treat as not-an-org", not a locked section or partial error.
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", "widgets");

        Assert.Equal(4, handler.RequestedPaths.Count);
        Assert.Empty(ledger.LockedSections);
        Assert.Empty(ledger.PartialErrors);
        Assert.DoesNotContain(ledger.Items, i => i.Level == "organization");
    }

    [Fact]
    public async Task GetLedgerAsync_403On404Failure_BecomesLockedSection_NotPartialError()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", null);

        Assert.Empty(ledger.PartialErrors);
        var locked = Assert.Single(ledger.LockedSections);
        Assert.Equal("organization", locked.Level);
        Assert.Equal("variable", locked.Kind);
    }

    [Fact]
    public async Task GetLedgerAsync_NonPermissionFailure_BecomesPartialError_WhenNotEveryJobFails()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom"}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", null);

        var error = Assert.Single(ledger.PartialErrors);
        Assert.Equal("organization variables", error.Label);
        Assert.Contains("Boom", error.Message);
        Assert.Empty(ledger.LockedSections);
    }

    [Fact]
    public async Task GetLedgerAsync_EveryJobFailsWithAGenuineError_ThrowsLedgerUnavailableException()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom1"}""")
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom2"}""");
        var service = CreateService(handler);

        await Assert.ThrowsAsync<LedgerUnavailableException>(() => service.GetLedgerAsync("octo-org", null));
    }

    [Fact]
    public async Task GetLedgerAsync_CompositeVariable_GetsResolvedValueFromTheSameReadsFetch()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":2,"variables":[{"name":"BASE_URL","value":"https://example.com","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},{"name":"CDN","value":"$(BASE_URL)/cdn","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", null);

        var cdn = Assert.Single(ledger.Items, i => i.Name == "CDN");
        Assert.Equal("https://example.com/cdn", cdn.ResolvedValue);
        Assert.Empty(cdn.UnresolvedReferences!);
        // No extra GitHub calls made for resolution — only the 2 read requests already fetched.
        Assert.Equal(2, handler.RequestedPaths.Count);
    }

    [Fact]
    public async Task GetLedgerAsync_CompositeVariableWithMissingReference_FlagsItUnresolved_DoesNotFailTheRead()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"CDN","value":"$(NOT_YET_CREATED)/cdn","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", null);

        var cdn = Assert.Single(ledger.Items, i => i.Name == "CDN");
        Assert.Equal(["NOT_YET_CREATED"], cdn.UnresolvedReferences);
        Assert.Equal("$(NOT_YET_CREATED)/cdn", cdn.ResolvedValue);
    }

    [Fact]
    public async Task GetLedgerAsync_PlainVariable_HasNoResolvedValue()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"PLAIN","value":"just-a-value","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", null);

        var plain = Assert.Single(ledger.Items);
        Assert.Null(plain.ResolvedValue);
    }

    [Fact]
    public async Task GetLedgerAsync_EveryJobLocked_DoesNotThrow_LockedIsNotTreatedAsFailure()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""")
            .Enqueue(HttpStatusCode.NotFound, """{"message":"Not Found"}""");
        var service = CreateService(handler);

        var ledger = await service.GetLedgerAsync("octo-org", null);

        Assert.Empty(ledger.Items);
        Assert.Empty(ledger.PartialErrors);
        Assert.Equal(2, ledger.LockedSections.Count);
    }
}
