const fs = require('fs').promises;
const fsSync = require('fs'); // For createReadStream if needed, or existsSync
const path = require('path');
const { google } = require('googleapis');
const { DATA_FOLDER, getSettings } = require('./config');

const CREDENTIALS_PATH = path.join(DATA_FOLDER, 'credentials.json');
const TOKEN_PATH = path.join(DATA_FOLDER, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

/**
 * Creates the OAuth2 client using credentials.json and settings.
 */
async function getOAuthClient() {
    try {
        const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
        const keys = JSON.parse(content);
        const key = keys.web || keys.installed;

        const settings = await getSettings();
        // Fallback to a default if not set, but prefer settings
        const redirectUri = settings.redirectUrl || 'https://consultoriobw.com.br/agenda/oauth2callback';

        return new google.auth.OAuth2(key.client_id, key.client_secret, redirectUri);
    } catch (e) {
        if (e.code === 'ENOENT') {
            throw new Error("CREDENTIALS_MISSING");
        }
        throw e;
    }
}

/**
 * Generates the URL for the user to consent to permissions.
 */
async function generateAuthUrl() {
    const client = await getOAuthClient();
    return client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
}

/**
 * Exchanges the auth code for tokens and saves them.
 */
async function getTokenFromCode(code) {
    const client = await getOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    return tokens;
}

/**
 * Loads the saved token and configures the client.
 */
async function getAuthenticatedClient() {
    // Check if token exists
    try {
        await fs.access(TOKEN_PATH);
    } catch {
        throw new Error("AUTH_REQUIRED");
    }

    try {
        const client = await getOAuthClient();
        const tokenContent = await fs.readFile(TOKEN_PATH, 'utf-8');
        const token = JSON.parse(tokenContent);
        client.setCredentials(token);
        return client;
    } catch (e) {
        // Parse error or client creation error
        console.error("Error loading token:", e);
        throw new Error("AUTH_REQUIRED");
    }
}

/**
 * Lists calendar events.
 */
async function listarEventos() {
    try {
        const auth = await getAuthenticatedClient();
        const calendar = google.calendar({ version: 'v3', auth });

        const settings = await getSettings();
        const diasParaVer = settings.diasEscopo || 1;

        const inicio = new Date();
        inicio.setDate(inicio.getDate() + 1); // Tomorrow
        inicio.setHours(0, 0, 0, 0);

        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + (diasParaVer - 1));
        fim.setHours(23, 59, 59, 999);

        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: inicio.toISOString(),
            timeMax: fim.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const eventosBrutos = res.data.items || [];

        return eventosBrutos.map(evento => {
            const dataObj = new Date(evento.start.dateTime || evento.start.date);
            const dataFormatada = dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
                " às " +
                dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            return {
                titulo: evento.summary || 'Sem Título',
                data: dataFormatada
            };
        });
    } catch (e) {
        // Handle Invalid Grant (Revoked Token)
        if (e.message && (e.message.includes('invalid_grant') || e.message.includes('invalid_token'))) {
             console.warn("Token expired or revoked. Deleting token file.");
             try { await fs.unlink(TOKEN_PATH); } catch (ign) {}
             throw new Error("AUTH_REQUIRED");
        }
        throw e;
    }
}

async function deleteToken() {
    try {
        await fs.unlink(TOKEN_PATH);
        return true;
    } catch (e) {
        if (e.code === 'ENOENT') return true; // Already gone
        throw e;
    }
}

module.exports = {
    generateAuthUrl,
    getTokenFromCode,
    listarEventos,
    deleteToken,
    CREDENTIALS_PATH, // Exported for Multer check if needed
    TOKEN_PATH
};