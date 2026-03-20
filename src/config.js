const fs = require('fs').promises;
const path = require('path');
const Mutex = require('./mutex');
const auth = require('./auth');

// Assuming this file is in src/, we go up one level to get to root.
const DATA_FOLDER = path.join(__dirname, '..', 'dados');
const SETTINGS_PATH = path.join(DATA_FOLDER, 'settings.json');
const settingsMutex = new Mutex();

const fsSync = require('fs');
if (!fsSync.existsSync(DATA_FOLDER)) {
    fsSync.mkdirSync(DATA_FOLDER);
}

const DEFAULT_SETTINGS = { 
    diasEscopo: 1, 
    senhaAdmin: "admin", 
    ocultarIgnorados: true,
    redirectUrl: "https://consultoriobw.com.br/agenda/oauth2callback" 
};

/**
 * Reads settings asynchronously.
 * Automatically migrates plain-text password to hash if detected.
 */
async function getSettings() {
    let rawContent = "";
    try {
        rawContent = await fs.readFile(SETTINGS_PATH, 'utf-8');
        if (!rawContent.trim()) throw new Error("Empty file");
        
        const userSettings = JSON.parse(rawContent);
        const merged = { ...DEFAULT_SETTINGS, ...userSettings };

        // AUTO-MIGRATION: If password is not a hash, hash it and save.
        if (merged.senhaAdmin && !auth.isHash(merged.senhaAdmin)) {
            console.log("Migrating plain-text password to hash...");
            merged.senhaAdmin = await auth.hashPassword(merged.senhaAdmin);
        }

        return merged;
    } catch (e) {
        if (e.code === 'ENOENT' || e instanceof SyntaxError || e.message === "Empty file") {
            console.warn("Settings file missing or corrupt. Using defaults.");
            return DEFAULT_SETTINGS;
        }
        return DEFAULT_SETTINGS;
    }
}

/**
 * Saves partial or full settings asynchronously.
 * Hashes password if it is being changed.
 */
async function saveSettings(newSettings) {
    const release = await settingsMutex.lock();
    try {
        // Read current
        let content = "{}";
        try { content = await fs.readFile(SETTINGS_PATH, 'utf-8'); } catch(e){}
        const current = content ? JSON.parse(content) : DEFAULT_SETTINGS;

        // Handle Password Hashing
        if (newSettings.senhaAdmin) {
            if (!auth.isHash(newSettings.senhaAdmin)) {
                 newSettings.senhaAdmin = await auth.hashPassword(newSettings.senhaAdmin);
            }
        }

        const updated = { ...DEFAULT_SETTINGS, ...current, ...newSettings };
        
        await fs.writeFile(SETTINGS_PATH, JSON.stringify(updated, null, 2));
        return updated;
    } finally {
        release();
    }
}

module.exports = {
    getSettings,
    saveSettings,
    DATA_FOLDER
};