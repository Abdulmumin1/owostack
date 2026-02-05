import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  maskSecretKey,
  generateEncryptionKey,
} from "./encryption";

describe("Encryption", () => {
  // Generate a test key for these tests
  const testKey = generateEncryptionKey();

  describe("encrypt/decrypt roundtrip", () => {
    it("should encrypt and decrypt a simple string", async () => {
      const plaintext = "sk_test_abc123xyz789";
      const encrypted = await encrypt(plaintext, testKey);

      // Encrypted should be different from plaintext
      expect(encrypted).not.toBe(plaintext);
      // Encrypted should be base64
      expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);

      const decrypted = await decrypt(encrypted, testKey);
      expect(decrypted).toBe(plaintext);
    });

    it("should handle empty strings", async () => {
      const plaintext = "";
      const encrypted = await encrypt(plaintext, testKey);
      const decrypted = await decrypt(encrypted, testKey);
      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode characters", async () => {
      const plaintext = "Paystack key: 💰🔑 naira ₦";
      const encrypted = await encrypt(plaintext, testKey);
      const decrypted = await decrypt(encrypted, testKey);
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertexts for same plaintext (random IV)", async () => {
      const plaintext = "sk_live_secret";
      const encrypted1 = await encrypt(plaintext, testKey);
      const encrypted2 = await encrypt(plaintext, testKey);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same plaintext
      expect(await decrypt(encrypted1, testKey)).toBe(plaintext);
      expect(await decrypt(encrypted2, testKey)).toBe(plaintext);
    });
  });

  describe("decrypt with wrong key", () => {
    it("should fail to decrypt with a different key", async () => {
      const plaintext = "secret_data";
      const encrypted = await encrypt(plaintext, testKey);
      const wrongKey = generateEncryptionKey();

      await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
    });
  });

  describe("maskSecretKey", () => {
    it("should mask a secret key correctly", () => {
      // sk_test_abc123xyz789 -> prefix "sk_test" (7 chars) + ... + last 4 "z789"
      expect(maskSecretKey("sk_test_abc123xyz789")).toBe("sk_test...z789");
    });

    it("should return null for null input", () => {
      expect(maskSecretKey(null)).toBe(null);
    });

    it("should return short keys unchanged", () => {
      expect(maskSecretKey("short")).toBe("short");
    });

    it("should mask live keys", () => {
      // sk_live_prod_keyvalue123 -> prefix "sk_live" (7 chars) + ... + last 4 "e123"
      expect(maskSecretKey("sk_live_prod_keyvalue123")).toBe("sk_live...e123");
    });
  });

  describe("generateEncryptionKey", () => {
    it("should generate a base64 string of correct length", () => {
      const key = generateEncryptionKey();
      // 256 bits = 32 bytes, base64 encoded = 44 characters
      expect(key).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(key.length).toBeGreaterThanOrEqual(40);
    });

    it("should generate unique keys each time", () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });
});
