using System.Text;
using GithubVariablesManager.Api.Services;
using Sodium;

namespace GithubVariablesManager.Api.Tests.Services;

/// <summary>
/// Real cryptography, no mocking — these round-trip through actual libsodium sealed-box calls
/// (via Sodium.Core) to prove SecretSealingService produces ciphertext GitHub's own recipients
/// (any holder of the matching private key) can genuinely open, not just "doesn't throw".
/// </summary>
public class SecretSealingServiceTests
{
    [Fact]
    public void Seal_RoundTripsThroughTheCorrespondingPrivateKey()
    {
        var keyPair = PublicKeyBox.GenerateKeyPair();
        var service = new SecretSealingService();
        const string plaintext = "super-secret-value";

        var sealedBase64 = service.Seal(plaintext, Convert.ToBase64String(keyPair.PublicKey));

        var opened = SealedPublicKeyBox.Open(Convert.FromBase64String(sealedBase64), keyPair.PrivateKey, keyPair.PublicKey);
        Assert.Equal(plaintext, Encoding.UTF8.GetString(opened));
    }

    [Fact]
    public void Seal_IsNonDeterministic_ProducesDifferentCiphertextEachCall()
    {
        var keyPair = PublicKeyBox.GenerateKeyPair();
        var service = new SecretSealingService();
        var publicKeyBase64 = Convert.ToBase64String(keyPair.PublicKey);

        var first = service.Seal("same-plaintext", publicKeyBase64);
        var second = service.Seal("same-plaintext", publicKeyBase64);

        Assert.NotEqual(first, second);
    }
}
