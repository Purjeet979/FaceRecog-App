/**
 * NHAI Datalake 3.0 — Crypto Layer (React Native)
 * 
 * Replicates the web-based crypto-layer.js using expo-crypto and crypto-js.
 */

import * as Crypto from 'expo-crypto';
import CryptoJS from 'crypto-js';

export const CryptoLayer = {
  /**
   * Generates a random UUID v4
   */
  randomUUID: (): string => {
    return Crypto.randomUUID();
  },

  /**
   * Generates random hex string of given byte length
   */
  randomHex: (bytes: number): string => {
    const arr = Crypto.getRandomBytes(bytes);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Retrieves or generates a persistent Device ID
   */
  getDeviceId: (): string => {
    // In production, fetch from SecureStorage/Keychain
    return 'DEVICE_' + CryptoLayer.randomHex(8).toUpperCase();
  },

  /**
   * Encrypts plaintext using AES-256 (via crypto-js)
   */
  encrypt: async (plaintext: string, secretKey: string): Promise<string> => {
    return CryptoJS.AES.encrypt(plaintext, secretKey).toString();
  },

  /**
   * Decrypts ciphertext using AES-256 (via crypto-js)
   */
  decrypt: async (ciphertext: string, secretKey: string): Promise<string> => {
    const bytes = CryptoJS.AES.decrypt(ciphertext, secretKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  },

  /**
   * Calculates SHA-256 hash
   */
  sha256: async (message: string): Promise<string> => {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, message);
  },

  /**
   * Simple CRC32 implementation for integrity checks
   */
  crc32: (str: string): number => {
    let crc = 0 ^ (-1);
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i);
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ (-1)) >>> 0;
  }
};
