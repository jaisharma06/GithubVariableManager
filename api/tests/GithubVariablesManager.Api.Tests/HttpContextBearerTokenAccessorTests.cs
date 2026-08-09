using GithubVariablesManager.Api.Auth;
using Microsoft.AspNetCore.Http;

namespace GithubVariablesManager.Api.Tests;

public class HttpContextBearerTokenAccessorTests
{
    [Fact]
    public void GetToken_ExtractsTokenFromBearerHeader()
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers.Authorization = "Bearer abc123";
        var sut = new HttpContextBearerTokenAccessor(new FakeHttpContextAccessor(httpContext));

        Assert.Equal("abc123", sut.GetToken());
    }

    [Fact]
    public void GetToken_ReturnsNullWhenHeaderMissing()
    {
        var sut = new HttpContextBearerTokenAccessor(new FakeHttpContextAccessor(new DefaultHttpContext()));

        Assert.Null(sut.GetToken());
    }

    private sealed class FakeHttpContextAccessor(HttpContext context) : IHttpContextAccessor
    {
        public HttpContext? HttpContext { get => context; set { } }
    }
}
