using ClosedXML.Excel;
using GithubVariablesManager.Api.Contracts;

namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Renders the merged ledger (<see cref="LedgerService.GetLedgerAsync"/>) as a downloadable
/// `.xlsx` workbook, one worksheet per level (Organization / Repository / one per environment) —
/// the export counterpart to <c>GET /api/ledger</c>. Reuses <see cref="LedgerService"/> in-process
/// rather than duplicating the fan-out/classification logic, matching this backend's established
/// "extend by composing an existing Service" pattern (see <c>Services.CopyService</c>).
///
/// Secrets are write-only — GitHub never returns a secret's value, to anyone — so every secret
/// row's <c>Value</c> cell is the literal <see cref="SecretValueMarker"/> string rather than blank,
/// matching this app's "honest about secrets" design language elsewhere (locked ledger rows, the
/// root README).
/// </summary>
public sealed class LedgerExportService(LedgerService ledgerService)
{
    public const string SecretValueMarker = "Write-only — GitHub never returns secret values";

    /// <summary>Excel forbids these characters in a sheet name, and caps the name at 31 characters.</summary>
    private static readonly char[] ForbiddenSheetNameChars = ['\\', '/', '?', '*', '[', ']', ':'];

    public async Task<(byte[] Content, string Filename)> ExportAsync(string org, string? repo)
    {
        // Let LedgerUnavailableException propagate uncaught — the export endpoint fails the same
        // way the read endpoint does when every fan-out job is locked/broken (502), rather than
        // producing an empty/confusing file.
        var ledger = await ledgerService.GetLedgerAsync(org, repo);

        var groups = GroupByLevel(ledger.Items);

        using var workbook = new XLWorkbook();
        var usedSheetNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var group in groups)
        {
            var sheetName = SanitizeSheetName(group.ScopeLabel, usedSheetNames);
            usedSheetNames.Add(sheetName);
            WriteLevelSheet(workbook, sheetName, group.Items);
        }

        if (ledger.PartialErrors.Count > 0 || ledger.LockedSections.Count > 0)
        {
            WriteNotesSheet(workbook, ledger.PartialErrors, ledger.LockedSections);
        }

        // A genuinely empty, fully-accessible scope (no variables/secrets set anywhere, nothing
        // locked, nothing errored) would otherwise leave the workbook with zero worksheets, which
        // ClosedXML refuses to save — add one explanatory sheet rather than let SaveAs throw.
        if (workbook.Worksheets.Count == 0)
        {
            workbook.Worksheets.Add("Ledger").Cell(1, 1).Value = "No variables or secrets found in this scope.";
        }

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);

        var filename = BuildFilename(org, repo);
        return (stream.ToArray(), filename);
    }

    /// <summary>
    /// Groups ledger items by level + scope-label (Organization / Repository / one group per
    /// environment name), in a fixed order: Organization, Repository, then environments in
    /// whatever order they first appear in <see cref="LedgerResponse.Items"/> (LedgerService's own
    /// iteration order). Levels with zero items are skipped entirely — no group is created for
    /// them — matching how the live ledger UI's Ledger.component.ts GroupItems only ever creates a
    /// group from an actual item or locked section.
    /// </summary>
    private static List<LevelGroup> GroupByLevel(IReadOnlyList<LedgerItemResponse> items)
    {
        var byLabel = new Dictionary<string, LevelGroup>();
        var orderedLabels = new List<string>();

        foreach (var item in items)
        {
            var label = item.Level switch
            {
                "organization" => "Organization",
                "repository" => "Repository",
                _ => item.Env ?? "",
            };

            if (!byLabel.TryGetValue(label, out var group))
            {
                group = new LevelGroup(label, []);
                byLabel[label] = group;
                orderedLabels.Add(label);
            }
            group.Items.Add(item);
        }

        // Fixed order: Organization, Repository, then environments in whatever order they first
        // appeared in Items (LedgerService's own iteration order) — not alphabetical.
        return orderedLabels
            .OrderBy(l => l == "Organization" ? 0 : l == "Repository" ? 1 : 2)
            .Select(l => byLabel[l])
            .ToList();
    }

    /// <summary>
    /// Rows sorted variables-before-secrets, then name ascending — mirrors
    /// Ledger.component.ts's GroupItems sort so the exported sheet matches what's on screen.
    /// </summary>
    private static void WriteLevelSheet(XLWorkbook workbook, string sheetName, List<LedgerItemResponse> items)
    {
        var sheet = workbook.Worksheets.Add(sheetName);

        sheet.Cell(1, 1).Value = "Name";
        sheet.Cell(1, 2).Value = "Kind";
        sheet.Cell(1, 3).Value = "Value";
        sheet.Cell(1, 4).Value = "Formula";
        sheet.Cell(1, 5).Value = "Visibility";
        sheet.Cell(1, 6).Value = "Created";
        sheet.Cell(1, 7).Value = "Updated";
        sheet.Row(1).Style.Font.Bold = true;

        var sorted = items
            .OrderBy(i => i.Kind == "variable" ? 0 : 1)
            .ThenBy(i => i.Name, StringComparer.Ordinal)
            .ToList();

        var row = 2;
        foreach (var item in sorted)
        {
            sheet.Cell(row, 1).Value = item.Name;
            sheet.Cell(row, 2).Value = item.Kind;
            sheet.Cell(row, 3).Value = item.Kind == "secret" ? SecretValueMarker : item.Value ?? "";
            // Additive column — the "Value" column above is always the real, already-resolved
            // GitHub literal now (even for a composite row); this carries the raw $(NAME) formula
            // text instead, populated only when the item's name is tracked in its scope's manifest
            // (composite variables only, never secrets) — see Services/CompositeManifestService.cs.
            sheet.Cell(row, 4).Value = item.Formula ?? "";
            sheet.Cell(row, 5).Value = item.Visibility ?? "";
            // XLCellValue has no DateTimeOffset conversion — Excel dates carry no timezone
            // concept, so this converts to UTC DateTime first (CreatedAt/UpdatedAt are already
            // UTC-sourced from GitHub).
            sheet.Cell(row, 6).Value = item.CreatedAt.UtcDateTime;
            sheet.Cell(row, 6).Style.DateFormat.Format = "yyyy-mm-dd hh:mm:ss";
            sheet.Cell(row, 7).Value = item.UpdatedAt.UtcDateTime;
            sheet.Cell(row, 7).Style.DateFormat.Format = "yyyy-mm-dd hh:mm:ss";
            row++;
        }

        sheet.Columns().AdjustToContents();
    }

    /// <summary>
    /// A downloaded static file has no dismissable partial-errors banner the way the live ledger
    /// screen does — this sheet carries that signal so a missing environment sheet reads as a
    /// permissions gap, not a bug.
    /// </summary>
    private static void WriteNotesSheet(
        XLWorkbook workbook,
        IReadOnlyList<LedgerPartialErrorResponse> partialErrors,
        IReadOnlyList<LedgerLockedSectionResponse> lockedSections)
    {
        var sheet = workbook.Worksheets.Add("Notes");

        sheet.Cell(1, 1).Value = "Type";
        sheet.Cell(1, 2).Value = "Detail";
        sheet.Row(1).Style.Font.Bold = true;

        var row = 2;
        foreach (var error in partialErrors)
        {
            sheet.Cell(row, 1).Value = "Partial error";
            sheet.Cell(row, 2).Value = $"{error.Label} — {error.Message}";
            row++;
        }

        foreach (var locked in lockedSections)
        {
            sheet.Cell(row, 1).Value = "Locked section";
            var label = locked.Level == "environment" ? $"environment \"{locked.Env}\"" : locked.Level;
            sheet.Cell(row, 2).Value = $"{label} {(locked.Kind == "variable" ? "variables" : "secrets")} — no access.";
            row++;
        }

        sheet.Columns().AdjustToContents();
    }

    /// <summary>
    /// Excel forbids <c>\ / ? * [ ] :</c> in sheet names and caps length at 31 characters. Truncation
    /// could collide two very long, similarly-prefixed environment names, so a numeric suffix is
    /// appended if the sanitized/truncated name is already taken.
    /// </summary>
    private static string SanitizeSheetName(string rawName, HashSet<string> usedNames)
    {
        var sanitized = new string(rawName.Select(c => ForbiddenSheetNameChars.Contains(c) ? '_' : c).ToArray()).Trim();
        if (sanitized.Length == 0) sanitized = "Sheet";
        if (sanitized.Length > 31) sanitized = sanitized[..31];

        if (!usedNames.Contains(sanitized)) return sanitized;

        var suffix = 2;
        string candidate;
        do
        {
            var suffixText = $"~{suffix}";
            var baseLength = Math.Min(sanitized.Length, 31 - suffixText.Length);
            candidate = sanitized[..baseLength] + suffixText;
            suffix++;
        } while (usedNames.Contains(candidate));

        return candidate;
    }

    private static string BuildFilename(string org, string? repo)
    {
        var date = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");
        return string.IsNullOrEmpty(repo)
            ? $"{org}-variables-secrets-{date}.xlsx"
            : $"{org}-{repo}-variables-secrets-{date}.xlsx";
    }

    private sealed record LevelGroup(string ScopeLabel, List<LedgerItemResponse> Items);
}
