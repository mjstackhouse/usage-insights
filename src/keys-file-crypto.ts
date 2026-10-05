import type { EncryptedKeysFile, KeysFilePayload } from './types';

// Keys files are encrypted in the browser with the Web Crypto API: AES-GCM with a key derived
// from the user's password (PBKDF2-SHA-256). Nothing is sent anywhere; without the password
// the file can't be read.
const PBKDF2_ITERATIONS = 600000;

const toBase64 = (bytes: Uint8Array): string => {
  // Build the string in chunks; spreading a large array into fromCharCode can exceed the call stack
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), char => char.charCodeAt(0));

const deriveKey = async (password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> => {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encryptKeysFile = async (payload: KeysFilePayload, password: string): Promise<EncryptedKeysFile> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));

  return {
    type: 'kontent-ai-usage-insights-keys',
    version: 2,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(new Uint8Array(encrypted))
  };
};

// Returns the parsed file if it looks like an encrypted keys file, otherwise null
export const parseEncryptedKeysFile = (text: string): EncryptedKeysFile | null => {
  try {
    const file = JSON.parse(text);
    const isValid = file?.type === 'kontent-ai-usage-insights-keys' &&
      file.version === 2 &&
      typeof file.kdf?.salt === 'string' &&
      Number.isInteger(file.kdf?.iterations) &&
      typeof file.cipher?.iv === 'string' &&
      typeof file.data === 'string';
    return isValid ? file : null;
  } catch {
    return null;
  }
};

// Throws if the password is wrong or the file was modified (AES-GCM authenticates the data)
export const decryptKeysFile = async (file: EncryptedKeysFile, password: string): Promise<KeysFilePayload> => {
  const key = await deriveKey(password, fromBase64(file.kdf.salt), file.kdf.iterations);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(file.cipher.iv) }, key, fromBase64(file.data));
  return JSON.parse(new TextDecoder().decode(decrypted));
};
