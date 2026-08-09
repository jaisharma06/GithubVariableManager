using System.Net;
using System.Text.Json;
using GithubVariablesManager.Api.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace GithubVariablesManager.Api.Tests.Auth;

public class PermissionErrorExceptionHandlerTests
{
    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, 401, false)]
    [InlineData(HttpStatusCode.Forbidden, 403, true)]
    [InlineData(HttpStatusCode.NotFound, 404, true)]
    [InlineData(HttpStatusCode.InternalServerError, 500, false)]
    public async Task TryHandleAsync_ClassifiesOctokitApiException(HttpStatusCode statusCode, int expectedStatus, bool expectedLocked)
    {
        var sut = new PermissionErrorExceptionHandler();
        var httpContext = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().BuildServiceProvider(),
        };
        httpContext.Response.Body = new MemoryStream();
        var exception = new Octokit.ApiException("GitHub said no.", statusCode);

        var handled = await sut.TryHandleAsync(httpContext, exception, CancellationToken.None);

        Assert.True(handled);
        Assert.Equal(expectedStatus, httpContext.Response.StatusCode);

        httpContext.Response.Body.Seek(0, SeekOrigin.Begin);
        using var doc = await JsonDocument.ParseAsync(httpContext.Response.Body);
        Assert.Equal(expectedLocked, doc.RootElement.GetProperty("locked").GetBoolean());
        Assert.Equal(expectedStatus, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("GitHub said no.", doc.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public async Task TryHandleAsync_ReturnsFalse_ForNonOctokitException()
    {
        var sut = new PermissionErrorExceptionHandler();
        var httpContext = new DefaultHttpContext { Response = { Body = new MemoryStream() } };

        var handled = await sut.TryHandleAsync(httpContext, new InvalidOperationException("boom"), CancellationToken.None);

        Assert.False(handled);
    }
}
