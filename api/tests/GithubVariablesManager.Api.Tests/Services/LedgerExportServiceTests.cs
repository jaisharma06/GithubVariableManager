using System.Net;
using ClosedXML.Excel;
using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

public class LedgerExportServiceTests
{
    private static LedgerExportService CreateService(FakeHttpMessageHandler handler)
    {
        var factory = new FakeGitHubClientFactory(handler);
        var actionsRestClient = new ActionsRestClient(factory);
        var environmentsService = new EnvironmentsService(actionsRestClient);
        var scopesService = new ScopesService(factory);
        var ledgerService = new LedgerService(actionsRestClient, environmentsService, scopesService, new CompositeVariableResolver(actionsRestClient));
        return new LedgerExportService(ledgerService);
    }

    private static XLWorkbook OpenWorkbook(byte[] content) => new(new MemoryStream(content));

    [Fact]
    public async Task ExportAsync_OrgOnlyScope_CreatesOrganizationSheetWithSortedRowsAndSecretMarker()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"V1","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-02T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"secrets":[{"name":"S1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-02T00:00:00Z","visibility":"all"}]}""");
        var service = CreateService(handler);

        var (content, filename) = await service.ExportAsync("octo-org", null);

        Assert.Equal($"octo-org-variables-secrets-{DateTimeOffset.UtcNow:yyyy-MM-dd}.xlsx", filename);

        using var workbook = OpenWorkbook(content);
        Assert.Equal(["Organization"], workbook.Worksheets.Select(w => w.Name));

        var sheet = workbook.Worksheet("Organization");
        Assert.Equal("Name", sheet.Cell(1, 1).GetString());
        Assert.Equal("Kind", sheet.Cell(1, 2).GetString());
        Assert.Equal("Value", sheet.Cell(1, 3).GetString());
        Assert.Equal("Formula", sheet.Cell(1, 4).GetString());
        Assert.Equal("Visibility", sheet.Cell(1, 5).GetString());

        // Variable sorts before secret, matching Ledger.component.ts's GroupItems order.
        Assert.Equal("V1", sheet.Cell(2, 1).GetString());
        Assert.Equal("variable", sheet.Cell(2, 2).GetString());
        Assert.Equal("v", sheet.Cell(2, 3).GetString());
        Assert.Equal("", sheet.Cell(2, 4).GetString()); // not composite -> Formula column blank

        Assert.Equal("S1", sheet.Cell(3, 1).GetString());
        Assert.Equal("secret", sheet.Cell(3, 2).GetString());
        Assert.Equal(LedgerExportService.SecretValueMarker, sheet.Cell(3, 3).GetString());
        Assert.NotEqual(LedgerExportService.SecretValueMarker, "v"); // sanity: never the actual value
        Assert.Equal("all", sheet.Cell(3, 5).GetString()); // org-level secret -> visibility populated

        Assert.True(sheet.Cell(2, 6).GetDateTime() > DateTime.MinValue); // real Excel date cell, not a string
    }

    [Fact]
    public async Task ExportAsync_CompositeVariable_FormulaColumnPopulated_ValueColumnIsTheResolvedLiteral()
    {
        // CDN's real GitHub value is always the resolved literal now — the manifest (the hidden
        // __GHVM_COMPOSITE_MANIFEST__ variable) is what carries the raw formula.
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":3,"variables":[{"name":"BASE_URL","value":"https://example.com","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},{"name":"CDN","value":"https://example.com/cdn","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"},{"name":"__GHVM_COMPOSITE_MANIFEST__","value":"{\"CDN\":\"$(BASE_URL)/cdn\"}","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var (content, _) = await service.ExportAsync("octo-org", null);

        using var workbook = OpenWorkbook(content);
        var sheet = workbook.Worksheet("Organization");
        var cdnRow = Enumerable.Range(2, sheet.LastRowUsed()!.RowNumber() - 1).First(r => sheet.Cell(r, 1).GetString() == "CDN");

        Assert.Equal("https://example.com/cdn", sheet.Cell(cdnRow, 3).GetString()); // real, already-resolved value
        Assert.Equal("$(BASE_URL)/cdn", sheet.Cell(cdnRow, 4).GetString()); // raw formula, from the manifest

        // The manifest variable itself is never a normal row.
        Assert.DoesNotContain(Enumerable.Range(2, sheet.LastRowUsed()!.RowNumber() - 1), r => sheet.Cell(r, 1).GetString() == "__GHVM_COMPOSITE_MANIFEST__");
    }

    [Fact]
    public async Task ExportAsync_EmptyLevelsAreSkipped_NoSheetForRepositoryOrEnvironmentsWithZeroItems()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"login":"octocat","type":"User"}""") // repo scope, non-org account -> org level skipped
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var (content, _) = await service.ExportAsync("octocat", "dotfiles");

        using var workbook = OpenWorkbook(content);
        // No Repository/Organization/Notes sheet — but ClosedXML refuses to save a workbook with
        // zero worksheets, so a genuinely empty, fully-accessible scope still gets one explanatory
        // fallback sheet rather than a crash.
        var sheetNames = workbook.Worksheets.Select(w => w.Name).ToList();
        Assert.DoesNotContain("Repository", sheetNames);
        Assert.DoesNotContain("Organization", sheetNames);
        Assert.DoesNotContain("Notes", sheetNames);
        Assert.Single(sheetNames);
    }

    [Fact]
    public async Task ExportAsync_RepositoryLevelSecret_VisibilityColumnBlank()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"login":"octocat","type":"User"}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"environments":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"secrets":[{"name":"S1","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""");
        var service = CreateService(handler);

        var (content, _) = await service.ExportAsync("octocat", "dotfiles");

        using var workbook = OpenWorkbook(content);
        var sheet = workbook.Worksheet("Repository");
        Assert.Equal("S1", sheet.Cell(2, 1).GetString());
        Assert.Equal("", sheet.Cell(2, 5).GetString());
    }

    [Fact]
    public async Task ExportAsync_NoPartialErrorsOrLockedSections_NoNotesSheet()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"V1","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var (content, _) = await service.ExportAsync("octo-org", null);

        using var workbook = OpenWorkbook(content);
        Assert.DoesNotContain("Notes", workbook.Worksheets.Select(w => w.Name));
    }

    [Fact]
    public async Task ExportAsync_LockedSection_AddsNotesSheetButNoDataSheetForThatLevel()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.Forbidden, """{"message":"Forbidden"}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var (content, _) = await service.ExportAsync("octo-org", null);

        using var workbook = OpenWorkbook(content);
        var sheetNames = workbook.Worksheets.Select(w => w.Name).ToList();
        Assert.DoesNotContain("Organization", sheetNames);
        Assert.Contains("Notes", sheetNames);

        var notes = workbook.Worksheet("Notes");
        Assert.Equal("Locked section", notes.Cell(2, 1).GetString());
    }

    [Fact]
    public async Task ExportAsync_PartialError_AddsNotesSheetRow()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom"}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var (content, _) = await service.ExportAsync("octo-org", null);

        using var workbook = OpenWorkbook(content);
        var notes = workbook.Worksheet("Notes");
        Assert.Equal("Partial error", notes.Cell(2, 1).GetString());
        Assert.Contains("Boom", notes.Cell(2, 2).GetString());
    }

    [Fact]
    public async Task ExportAsync_EveryJobFailsWithGenuineError_ThrowsLedgerUnavailableException()
    {
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom1"}""")
            .Enqueue(HttpStatusCode.InternalServerError, """{"message":"Boom2"}""");
        var service = CreateService(handler);

        await Assert.ThrowsAsync<LedgerUnavailableException>(() => service.ExportAsync("octo-org", null));
    }

    [Fact]
    public async Task ExportAsync_EnvironmentNamesWithForbiddenCharsAndOverlength_SanitizedAndDeduplicated()
    {
        var collisionPrefix = new string('A', 31);
        var handler = new FakeHttpMessageHandler()
            .Enqueue(HttpStatusCode.OK, """{"login":"octocat","type":"User"}""") // org level skipped, fewer requests to wire up
            .Enqueue(HttpStatusCode.OK, $$"""{"total_count":3,"environments":[{"id":1,"name":"prod:env"},{"id":2,"name":"{{collisionPrefix}}1"},{"id":3,"name":"{{collisionPrefix}}2"}]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"variables":[]}""") // repo variables (empty -> no Repository sheet)
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""")   // repo secrets
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"V","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""") // prod:env variables
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"V","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""") // env 1 variables
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""")
            .Enqueue(HttpStatusCode.OK, """{"total_count":1,"variables":[{"name":"V","value":"v","created_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}]}""") // env 2 variables
            .Enqueue(HttpStatusCode.OK, """{"total_count":0,"secrets":[]}""");
        var service = CreateService(handler);

        var (content, _) = await service.ExportAsync("octocat", "dotfiles");

        using var workbook = OpenWorkbook(content);
        var sheetNames = workbook.Worksheets.Select(w => w.Name).ToList();

        // Forbidden ':' replaced, and every sheet name stays within Excel's 31-char cap.
        Assert.Contains("prod_env", sheetNames);
        Assert.All(sheetNames, n => Assert.True(n.Length <= 31));

        // The two overlength names truncate to the same 31-char prefix — the second gets a
        // numeric-suffixed, still-unique name rather than silently colliding.
        Assert.Contains(collisionPrefix, sheetNames);
        Assert.Contains(sheetNames, n => n != collisionPrefix && n.StartsWith("AAAA"));
        Assert.Equal(sheetNames.Count, sheetNames.Distinct().Count());
    }
}
