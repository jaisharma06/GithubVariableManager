namespace GithubVariablesManager.Api.Services;

/// <summary>
/// Libsodium sealed-box encryption against a scope's published public key, per GitHub's documented
/// scheme for encrypting Actions secrets. Ported server-side from the old
/// <c>client/src/app/core/services/SecretSealingService.ts</c> (Phase 3b) — the platform fact this
/// exists for (GitHub never returns a secret's value, to anyone, at any level) is unchanged; only
/// where the sealing happens moved. Kept as its own class rather than inlined into
/// <see cref="ItemMutationService"/> for the same reason the Angular original was split from
/// <c>GithubSecretsGateway.service.ts</c>: libsodium mechanics are a distinct concern from "what
/// order to call GitHub's API in".
/// </summary>
public sealed class SecretSealingService
{
    public string Seal(string plaintextValue, string publicKeyBase64)
    {
        var publicKey = Convert.FromBase64String(publicKeyBase64);
        var message = System.Text.Encoding.UTF8.GetBytes(plaintextValue);
        var sealedBytes = Sodium.SealedPublicKeyBox.Create(message, publicKey);
        return Convert.ToBase64String(sealedBytes);
    }
}
