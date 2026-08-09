namespace GithubVariablesManager.Api.Contracts;

public sealed record DeviceCodeResponse(string DeviceCode, string UserCode, string VerificationUri, int ExpiresIn, int Interval);
public sealed record DeviceTokenRequest(string DeviceCode);
public sealed record DeviceTokenResponse(string Status, string? Token, int? Interval, string? Message);
public sealed record ClientIdResponse(string? ClientId);
public sealed record ErrorResponse(string Error);
public sealed record ViewerResponse(string Login, string AvatarUrl);
