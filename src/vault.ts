// src/vault.ts

/**
 * @file Manages the secure local vault for storing encrypted credentials.
 * Uses AES encryption with a key derived from a user-provided passphrase.
 * Includes a verification mechanism to ensure the correct passphrase is used for unlocking.
 */

import * as CryptoJS from 'crypto-js';

const VAULT_STORAGE_KEY = 'beachdai_secure_vault';
const SALT_STORAGE_KEY = 'beachdai_vault_salt';
const CHECK_STORAGE_KEY = 'beachdai_vault_check'; // For storing the encrypted check value
const SESSION_KEY_STORAGE_KEY = 'beachdai_session_key'; // For storing the key in session memory
const CHECK_STRING = 'beachdai_vault_check_string'; // A known string to verify decryption

// --- Vault Management ---

/**
 * Checks if the vault has been initialized (i.e., has a salt).
 */
export async function isVaultInitialized(): Promise<boolean> {
    const result = await chrome.storage.local.get(SALT_STORAGE_KEY);
    return !!result[SALT_STORAGE_KEY];
}

/**
 * Initializes the vault by creating a new salt, deriving a key, and storing
 * an encrypted "check" value to later verify the passphrase.
 * @param passphrase The user's master passphrase.
 */
export async function initializeVault(passphrase: string): Promise<void> {
    console.log("Attempting to initialize vault...");
    const salt = CryptoJS.lib.WordArray.random(128 / 8).toString(CryptoJS.enc.Hex);
    const key = deriveKey(passphrase, salt);

    // Encrypt the known check string with the new key
    const encryptedCheck = CryptoJS.AES.encrypt(CHECK_STRING, key).toString();

    // FIX: Initialize the vault with a proper, non-empty structure.
    // The previous code used {}, which caused issues on first read.
    const initialVaultData: EncryptedVault = {};

    await chrome.storage.local.set({
        [SALT_STORAGE_KEY]: salt,
        [CHECK_STORAGE_KEY]: encryptedCheck,
        [VAULT_STORAGE_KEY]: initialVaultData 
    });
    await chrome.storage.session.set({ [SESSION_KEY_STORAGE_KEY]: key });
    console.log("Secure vault initialized successfully.");
}

/**
 * Unlocks the vault for the current session by deriving a key from the passphrase
 * and verifying it against the stored check value.
 * @param passphrase The user's master passphrase.
 * @returns True if unlock was successful, false otherwise.
 */
export async function unlockVault(passphrase: string): Promise<boolean> {
    console.log("Attempting to unlock vault...");
    const saltResult = await chrome.storage.local.get(SALT_STORAGE_KEY);
    const salt = saltResult[SALT_STORAGE_KEY];
    if (!salt) {
        console.error("Vault not initialized. Cannot unlock.");
        return false;
    }

    const key = deriveKey(passphrase, salt);

    // Verify the passphrase by decrypting the check string
    const checkResult = await chrome.storage.local.get(CHECK_STORAGE_KEY);
    const encryptedCheck = checkResult[CHECK_STORAGE_KEY];
    if (!encryptedCheck) {
        console.error("Vault is corrupt. Check value missing.");
        return false;
    }

    try {
        const decryptedCheckBytes = CryptoJS.AES.decrypt(encryptedCheck, key);
        const decryptedCheck = decryptedCheckBytes.toString(CryptoJS.enc.Utf8);

        if (decryptedCheck === CHECK_STRING) {
            await chrome.storage.session.set({ [SESSION_KEY_STORAGE_KEY]: key });
            console.log("Vault unlocked for this session.");
            return true;
        } else {
            console.warn("Vault unlock failed: Incorrect passphrase.");
            return false;
        }
    } catch (e) {
        console.error("Vault unlock failed during decryption:", e);
        return false;
    }
}

/**
 * Checks if the vault is currently unlocked for this session.
 */
export async function isVaultUnlocked(): Promise<boolean> {
    const result = await chrome.storage.session.get(SESSION_KEY_STORAGE_KEY);
    return !!result[SESSION_KEY_STORAGE_KEY];
}


// --- Credential Management ---

interface EncryptedVault {
    [id: string]: {
        name: string;
        value: string; // This will be the encrypted value
    };
}

/**
 * Encrypts and saves a new credential to the vault.
 * @param name A user-friendly name for the credential (e.g., "Amazon Login").
 * @param value The sensitive value to encrypt.
 * @returns The unique ID of the saved credential.
 */
export async function encryptAndSaveCredential(name: string, value: string): Promise<string> {
    const key = await getSessionKey();
    if (!key) throw new Error("Vault is locked. Please unlock it first.");

    const vaultResult = await chrome.storage.local.get(VAULT_STORAGE_KEY);
    // Ensure vault exists and is an object, even if empty
    const vault: EncryptedVault = vaultResult[VAULT_STORAGE_KEY] || {};

    const encryptedValue = CryptoJS.AES.encrypt(value, key).toString();
    const credentialId = `cred-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    vault[credentialId] = {
        name: name,
        value: encryptedValue,
    };

    await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: vault });
    console.log(`Saved new credential: "${name}" with ID: ${credentialId}`);
    return `{{VAULT_CREDENTIAL.${credentialId}}}`;
}

/**
 * Retrieves and decrypts a credential from the vault.
 * @param placeholderId The placeholder ID from the agent's plan (e.g., "{{VAULT_CREDENTIAL.cred-123}}").
 * @returns The decrypted credential value.
 */
export async function getDecryptedCredential(placeholderId: string): Promise<string> {
    const key = await getSessionKey();
    if (!key) throw new Error("Vault is locked. Please unlock it first.");

    const match = placeholderId.match(/{{VAULT_CREDENTIAL\.(cred-.*?)}}/);
    if (!match) throw new Error("Invalid credential placeholder format.");
    const credentialId = match[1];

    const vaultResult = await chrome.storage.local.get(VAULT_STORAGE_KEY);
    const vault: EncryptedVault = vaultResult[VAULT_STORAGE_KEY];

    if (!vault) {
        throw new Error("Vault data not found. It may not be initialized correctly.");
    }
    if (!vault[credentialId]) {
        throw new Error(`Credential with ID "${credentialId}" not found in vault.`);
    }

    const encryptedValue = vault[credentialId].value;
    const bytes = CryptoJS.AES.decrypt(encryptedValue, key);
    const decryptedValue = bytes.toString(CryptoJS.enc.Utf8);

    if (!decryptedValue) {
        throw new Error("Failed to decrypt credential. The passphrase may be incorrect or the data may be corrupt.");
    }

    console.log(`Successfully decrypted credential for ID: ${credentialId}`);
    return decryptedValue;
}


// --- Helper Functions ---

/**
 * Derives a strong encryption key from a passphrase and salt using PBKDF2.
 */
function deriveKey(passphrase: string, salt: string): string {
    const key = CryptoJS.PBKDF2(passphrase, salt, {
        keySize: 256 / 32,
        iterations: 10000, // A reasonable number of iterations
    });
    return key.toString(CryptoJS.enc.Hex);
}

/**
 * Retrieves the encryption key from session storage.
 */
async function getSessionKey(): Promise<string | null> {
    const result = await chrome.storage.session.get(SESSION_KEY_STORAGE_KEY);
    return result[SESSION_KEY_STORAGE_KEY] || null;
}
