import crypto from 'crypto';
import { config } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Retrieves the 32-byte encryption key buffer from config
 * @returns {Buffer}
 */
const getKeyBuffer = () => {
  const hexKey = config.security.encryptionKey;
  if (!hexKey) {
    throw new Error('ENCRYPTION_KEY environment variable is not configured.');
  }

  // If provided as 64-char hex, convert to 32-byte buffer
  if (hexKey.length === 64) {
    return Buffer.from(hexKey, 'hex');
  }

  // If provided as plain string, hash to 32 bytes
  return crypto.createHash('sha256').update(hexKey).digest();
};

/**
 * Encrypts plain text using AES-256-GCM
 * @param {string} text Plain text to encrypt
 * @returns {string} Combined format "iv:ciphertext:authTag" in hex
 */
export const encrypt = (text) => {
  if (!text) return text;
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
};

/**
 * Decrypts AES-256-GCM combined format "iv:ciphertext:authTag"
 * @param {string} encryptedCombined Combined string from encrypt()
 * @returns {string} Decrypted plain text
 */
export const decrypt = (encryptedCombined) => {
  if (!encryptedCombined) return encryptedCombined;
  const parts = encryptedCombined.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format. Expected iv:ciphertext:authTag');
  }

  const [ivHex, ciphertextHex, authTagHex] = parts;
  const key = getKeyBuffer();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};
