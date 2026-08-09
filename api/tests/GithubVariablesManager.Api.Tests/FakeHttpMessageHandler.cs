using System.Net;
using System.Text;

namespace GithubVariablesManager.Api.Tests;

/// <summary>
/// Shared test double standing in for the network — returns one canned JSON/status response per
/// call, in call order, so a test can script GitHub's exact response sequence without a real HTTP
/// call. Wired into a typed <see cref="HttpClient"/> via its <see cref="HttpMessageHandler"/>.
/// Mirrors <c>TestDoubles.ts</c>'s fake-gateway convention as closely as C# allows.
/// </summary>
public sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    // Plain Queue/List, not concurrent collections, plus an explicit lock around every mutation
    // below — WorkflowRunCleanupService's per-chunk Task.WhenAll (up to 5 concurrent Octokit calls
    // sharing one fake handler in tests) is the first genuinely concurrent usage of this double;
    // every prior consumer only ever issued sequential requests, so this was never exercised before.
    private readonly object gate = new();
    private readonly Queue<(HttpStatusCode Status, string Json, string? LinkHeader)> responses = new();
    private readonly List<string?> requestedPaths = [];
    private readonly List<HttpMethod> requestedMethods = [];
    private readonly List<string?> requestedBodies = [];

    public List<string?> RequestedPaths { get { lock (gate) { return [.. requestedPaths]; } } }
    public List<HttpMethod> RequestedMethods { get { lock (gate) { return [.. requestedMethods]; } } }
    public List<string?> RequestedBodies { get { lock (gate) { return [.. requestedBodies]; } } }

    public FakeHttpMessageHandler Enqueue(HttpStatusCode status, string json)
    {
        lock (gate) { responses.Enqueue((status, json, null)); }
        return this;
    }

    /// <summary>
    /// Same as <see cref="Enqueue(HttpStatusCode, string)"/>, plus a <c>Link</c> response header —
    /// needed to script Octokit's native Link-header pagination (e.g. <c>rel="next"</c>) across
    /// multiple enqueued pages.
    /// </summary>
    public FakeHttpMessageHandler Enqueue(HttpStatusCode status, string json, string linkHeader)
    {
        lock (gate) { responses.Enqueue((status, json, linkHeader)); }
        return this;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.PathAndQuery;
        var method = request.Method;
        var body = request.Content is not null ? await request.Content.ReadAsStringAsync(cancellationToken) : null;

        HttpStatusCode status;
        string json;
        string? linkHeader;
        lock (gate)
        {
            requestedPaths.Add(path);
            requestedMethods.Add(method);
            requestedBodies.Add(body);

            (status, json, linkHeader) = responses.Count > 0
                ? responses.Dequeue()
                : (HttpStatusCode.InternalServerError, "{}", null);
        }

        var response = new HttpResponseMessage(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        if (linkHeader is not null)
        {
            response.Headers.Add("Link", linkHeader);
        }
        return response;
    }
}
