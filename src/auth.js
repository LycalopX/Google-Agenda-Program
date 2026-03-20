const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const randomBytes = promisify(crypto.randomBytes);

// Checks if the string matches the "salt:hash" format
function isHash(str) {
    return /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(str);
}

/**
 * Hashes a password using scrypt.
 * Format: salt(hex):hash(hex)
 */
async function hashPassword(password) {
    const salt = await randomBytes(16);
    const derivedKey = await scrypt(password, salt, 64);
    return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a password against a stored hash (or plain text for legacy).
 */
async function verifyPassword(password, storedData) {
    if (!storedData) return false;

    // Legacy: Plain Text
    if (!isHash(storedData)) {
        return password === storedData;
    }

    // Secure: Hash
    const [saltHex, keyHex] = storedData.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const key = Buffer.from(keyHex, 'hex');

    const derivedKey = await scrypt(password, salt, 64);
    return crypto.timingSafeEqual(key, derivedKey);
}

module.exports = {
    hashPassword,
    verifyPassword,
    isHash
};