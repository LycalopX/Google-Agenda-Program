const express = require('express');
const path = require('path');
const multer = require('multer');

// Services
const configService = require('./src/config');
const dbService = require('./src/database');
const googleService = require('./src/googleService');
const utils = require('./src/utils');
const auth = require('./src/auth');
const rateLimiter = require('./src/rateLimiter');

const router = express.Router();

// --- MULTER CONFIG ---
// We use the DATA_FOLDER defined in config
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, configService.DATA_FOLDER);
    },
    filename: function (req, file, cb) {
        if (file.fieldname === 'credenciais') cb(null, 'credentials.json');
        else if (file.fieldname === 'banco') cb(null, 'pacientes.json');
        else cb(new Error("Arquivo não permitido"), false);
    }
});
const upload = multer({ storage: storage });

// --- MIDDLEWARE ---
router.use(express.json());
router.use(express.static(path.join(__dirname, 'public')));

// --- AUTH ROUTES ---
router.get('/api/auth-url', async (req, res) => {
    try {
        const url = await googleService.generateAuthUrl();
        res.json({ url });
    } catch (e) {
        if (e.message === 'CREDENTIALS_MISSING') {
            return res.status(500).json({ error: "Arquivo credentials.json não encontrado." });
        }
        res.status(500).json({ error: "Erro interno: " + e.message });
    }
});

router.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send("Erro: Sem código.");

    try {
        await googleService.getTokenFromCode(code);
        // Redirect to the agenda home (mounted at /agenda by MasterHub)
        res.redirect('/agenda'); 
    } catch (e) {
        res.send("Erro ao gerar token: " + e.message);
    }
});

router.post('/api/delete-token', async (req, res) => {
    try {
        await googleService.deleteToken();
        res.json({ success: true, message: "Token apagado com sucesso." });
    } catch (e) {
        console.error("Erro ao apagar token:", e);
        res.status(500).json({ success: false, message: "Erro interno." });
    }
});

// --- PACIENTES ROUTES ---
router.get('/api/pacientes', async (req, res) => {
    try {
        const data = await dbService.getPacientes();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/salvar', async (req, res) => {
    try {
        const { nome, telefone } = req.body;
        const numeroLimpo = utils.prepararNumero(telefone);

        if (!numeroLimpo) {
            return res.status(400).json({ success: false, message: "Número inválido" });
        }

        await dbService.salvarPaciente(nome, numeroLimpo);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/api/marcar-informado', async (req, res) => {
    try {
        const { nome, informado } = req.body;
        await dbService.marcarInformado(nome, informado);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- AGENDA ROUTES ---
router.get('/api/agenda', async (req, res) => {
    try {
        const eventos = await googleService.listarEventos();
        res.json(eventos);
    } catch (e) {
        if (e.message === "AUTH_REQUIRED") {
            return res.status(401).json({ error: "AUTH_REQUIRED" });
        }
        console.error(e);
        res.status(500).json({ error: "Erro ao buscar agenda: " + e.message });
    }
});

// --- SETTINGS ROUTES ---
router.get('/api/settings', async (req, res) => {
    try {
        const settings = await configService.getSettings();
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: "Erro ao ler configurações" });
    }
});

router.post('/api/settings', async (req, res) => {
    try {
        await configService.saveSettings(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- UPLOAD ROUTE ---
const uploadFields = upload.fields([{ name: 'credenciais', maxCount: 1 }, { name: 'banco', maxCount: 1 }]);

// Apply Rate Limiter here
router.post('/api/upload', rateLimiter, (req, res) => {
    uploadFields(req, res, async function (err) {
        if (err) return res.status(500).json({ success: false, message: err.message });

        // Secure auth check
        const { senha } = req.body;
        try {
            const settings = await configService.getSettings();
            
            // Validate password (supports both Legacy Plain Text and Scrypt Hash)
            const isValid = await auth.verifyPassword(senha, settings.senhaAdmin);

            if (!isValid) {
                return res.status(403).json({ success: false, message: "Senha incorreta!" });
            }

            res.json({ success: true, message: "Arquivo atualizado!" });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, message: "Erro ao verificar permissão." });
        }
    });
});

module.exports = router;