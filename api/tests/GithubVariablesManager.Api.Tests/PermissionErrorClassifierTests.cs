using GithubVariablesManager.Api.Auth;

namespace GithubVariablesManager.Api.Tests;

public class PermissionErrorClassifierTests
{
    [Theory]
    [InlineData(403, true)]
    [InlineData(404, true)]
    [InlineData(500, false)]
    [InlineData(200, false)]
    public void Classify_MarksOnly403And404AsLocked(int status, bool expectedLocked)
    {
        var result = PermissionErrorClassifier.Classify(status, "message");
        Assert.Equal(expectedLocked, result.Locked);
        Assert.Equal(status, result.Status);
    }
}
