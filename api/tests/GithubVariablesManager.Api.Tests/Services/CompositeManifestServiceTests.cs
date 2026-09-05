using GithubVariablesManager.Api.GitHub;
using GithubVariablesManager.Api.Services;

namespace GithubVariablesManager.Api.Tests.Services;

/// <summary>
/// Direct unit tests of <see cref="CompositeManifestService.ParseManifest"/>'s three outcomes —
/// absent/corrupted/valid — over an in-memory <see cref="RawVariable"/> list, no GitHub calls
/// involved. <see cref="LedgerServiceTests"/> covers the same distinction end-to-end through
/// <c>GetLedgerAsync</c>'s fan-out, including the "absent != corrupted" regression guard.
/// </summary>
public class CompositeManifestServiceTests
{
    private static RawVariable ManifestVariable(string value) => new()
    {
        Name = CompositeManifestService.ManifestVariableName,
        Value = value,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public void ParseManifest_NoManifestVariablePresent_IsEmptyAndNotCorrupted()
    {
        var result = CompositeManifestService.ParseManifest([]);

        Assert.False(result.Corrupted);
        Assert.Empty(result.Manifest);
    }

    [Fact]
    public void ParseManifest_InvalidJson_IsEmptyAndCorrupted()
    {
        var result = CompositeManifestService.ParseManifest([ManifestVariable("not json")]);

        Assert.True(result.Corrupted);
        Assert.Empty(result.Manifest);
    }

    [Fact]
    public void ParseManifest_ValidJsonWrongShape_NestedObjectValue_IsEmptyAndCorrupted()
    {
        var result = CompositeManifestService.ParseManifest([ManifestVariable("""{"X":{"nested":1}}""")]);

        Assert.True(result.Corrupted);
        Assert.Empty(result.Manifest);
    }

    [Fact]
    public void ParseManifest_ValidJsonWrongShape_ArrayInsteadOfObject_IsEmptyAndCorrupted()
    {
        var result = CompositeManifestService.ParseManifest([ManifestVariable("""["not","an","object"]""")]);

        Assert.True(result.Corrupted);
        Assert.Empty(result.Manifest);
    }

    [Fact]
    public void ParseManifest_LiteralJsonNull_IsEmptyAndCorrupted()
    {
        // A successfully-parsed literal `null` deserializes without throwing but isn't the expected
        // {name: formula} object — must still be flagged corrupted, not silently treated as "absent".
        var result = CompositeManifestService.ParseManifest([ManifestVariable("null")]);

        Assert.True(result.Corrupted);
        Assert.Empty(result.Manifest);
    }

    [Fact]
    public void ParseManifest_ValidManifest_IsPopulatedAndNotCorrupted()
    {
        var result = CompositeManifestService.ParseManifest([ManifestVariable("""{"CDN":"$(BASE_URL)/cdn"}""")]);

        Assert.False(result.Corrupted);
        Assert.Equal("$(BASE_URL)/cdn", result.Manifest["CDN"]);
    }

    [Fact]
    public void ParseManifest_ValidEmptyManifest_IsEmptyAndNotCorrupted()
    {
        var result = CompositeManifestService.ParseManifest([ManifestVariable("{}")]);

        Assert.False(result.Corrupted);
        Assert.Empty(result.Manifest);
    }
}
