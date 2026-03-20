const fs = require('fs').promises;
const path = require('path');
const { DATA_FOLDER } = require('./config');
const Mutex = require('./mutex');

const DB_PATH = path.join(DATA_FOLDER, 'pacientes.json');
const dbMutex = new Mutex();

/**
 * Returns the entire database object.
 */
async function getPacientes() {
    try {
        const data = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        if (e.code === 'ENOENT') return {};
        throw e;
    }
}

/**
 * Saves or updates a patient's phone number.
 */
async function salvarPaciente(nome, telefoneLimpo) {
    const release = await dbMutex.lock();
    try {
        let db = await getPacientes();

        // Ensure object existence
        if (typeof db[nome] !== 'object' || db[nome] === null) {
            db[nome] = {};
        }

        db[nome].telefone = telefoneLimpo;
        
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
        return db[nome];
    } finally {
        release();
    }
}

/**
 * Updates the 'informadoEm' timestamp.
 */
async function marcarInformado(nome, status) {
    const release = await dbMutex.lock();
    try {
        let db = await getPacientes();

        if (typeof db[nome] !== 'object' || db[nome] === null) {
            db[nome] = {};
        }

        db[nome].informadoEm = status ? new Date() : null;

        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
        return db[nome];
    } finally {
        release();
    }
}

module.exports = {
    getPacientes,
    salvarPaciente,
    marcarInformado
};