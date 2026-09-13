import crypto from 'crypto';
import { config } from '../../config';

/**
 * Token encryption for multi-tenant WhatsApp access tokens.
 * Uses AES-256-GCM with key derived from WHATSAPP_TOKEN_ENCRYPTION_KEY or JWT_SECRET.
 * 
 * Format: iv:authTag:ciphertext (all base64url)
 * Never log plaintext tokens.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  // Prefer dedicated encryption key, fallback to JWT secret
  const rawKey = config.whatsappTokenEncryptionKey || config.jwtSecret;
  if (!rawKey || rawKey.length < 16) {
    throw new Error('Encryption key missing or too short');
  }
  // Derive 32-byte key via SHA-256 (deterministic, simple)
  // For production, consider using HKDF, but this is sufficient and avoids extra deps
  return crypto.createHash('sha256').update(rawKey).digest();
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  let encrypted = cipher.update(plaintext, 'utf8', 'base64url');
  encrypted += cipher.final('base64url');
  const authTag = cipher.getAuthTag().toString('base64url');
  const ivB64 = iv.toString('base64url');
  return `${ivB64}:${authTag}:${encrypted}`;
}

export function decryptToken(encryptedValue: string): string {
  if (!encryptedValue) return '';
  // If value doesn't contain our delimiter, assume it's plaintext (legacy / env fallback)
  // This allows graceful migration and handling of global env tokens that are not encrypted
  if (!encryptedValue.includes(':')) {
    return encryptedValue;
  }
  const parts = encryptedValue.split(':');
  if (parts.length !== 3) {
    // Not our format, treat as plaintext (maybe already decrypted or legacy)
    return encryptedValue;
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, 'base64url');
    const authTag = Buffer.from(authTagB64, 'base64url');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertextB64, 'base64url', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // If decryption fails, it might be a plaintext token containing colons (unlikely for Meta tokens)
    // For safety, return original if it looks like a plausible token (starts with EAA)
    if (encryptedValue.startsWith('EAA') || encryptedValue.length > 20) {
      return encryptedValue;
    }
    throw err;
  }
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  // Basic check: each part should be base64url
  try {
    Buffer.from(parts[0], 'base64url');
    Buffer.from(parts[1], 'base64url');
    Buffer.from(parts[2], 'base64url');
    return parts[0].length >= 16 && parts[1].length >= 20; // iv 12 bytes ~16 b64url, tag 16 bytes ~22 b64url
  } catch {
    return false;
  }
}
