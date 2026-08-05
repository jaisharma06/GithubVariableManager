/** Seals a plaintext secret against a repo/org/environment's public key, per GitHub's documented scheme. */
export async function sealSecret(plaintext: string, publicKeyBase64: string): Promise<string> {
  const sodium = (await import('libsodium-wrappers')).default
  await sodium.ready
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL)
  const message = sodium.from_string(plaintext)
  const sealed = sodium.crypto_box_seal(message, key)
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL)
}
