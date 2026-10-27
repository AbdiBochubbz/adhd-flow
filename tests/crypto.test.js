import assert from "node:assert/strict";
import test from "node:test";
import { ITERATIONS, checkVerifier, decryptJson, deriveKey, encryptJson, makeVerifier, randomBytes } from "../src/crypto.js";

function contains(haystack, needle) {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

test("AES-GCM round trip hides the plaintext and rejects the wrong key", async () => {
  const salt = randomBytes(16);
  const key = await deriveKey("correct horse", salt, 5_000);
  const wrong = await deriveKey("nope nope nope", salt, 5_000);
  const packed = await encryptJson(key, { title: "secret homework", steps: ["one"] });
  const raw = new Uint8Array([...packed.iv, ...packed.ct]);
  assert.equal(contains(raw, new TextEncoder().encode("secret homework")), false);
  const opened = await decryptJson(key, packed);
  assert.equal(opened.title, "secret homework");
  assert.deepEqual(opened.steps, ["one"]);
  await assert.rejects(() => decryptJson(wrong, packed));
  const verifier = await makeVerifier(key);
  assert.equal(await checkVerifier(key, verifier), true);
  assert.equal(await checkVerifier(wrong, verifier), false);
});

test("the production iteration count can derive a key", async () => {
  const salt = randomBytes(16);
  const key = await deriveKey("2468", salt, ITERATIONS);
  const packed = await encryptJson(key, { ok: true });
  assert.equal((await decryptJson(key, packed)).ok, true);
});
