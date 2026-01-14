
const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { google } = require('googleapis');

const router = express.Router();

// --- CONFIGURAÇÕES DO GOOGLE ---
// Escopos: Que permissão precisamos? Apenas ler eventos.
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// Define a pasta onde os dados sensíveis ficam
const DATA_FOLDER = path.join(__dirname, 'dados');

// Garante que a pasta existe (se não existir, o código cria para evitar erro)
if (!fs.existsSync(DATA_FOLDER)) {
    fs.mkdirSync(DATA_FOLDER);
}

// Agora os arquivos ficam dentro dessa pasta
const CREDENTIALS_PATH = path.join(DATA_FOLDER, 'credentials.json');
const TOKEN_PATH = path.join(DATA_FOLDER, 'token.json');
const DB_PATH = path.join(DATA_FOLDER, 'pacientes.json');
const SETTINGS_PATH = path.join(DATA_FOLDER, 'settings.json');

// --- FUNÇÕES UTILITÁRIAS ---


// --- GERENCIAMENTO DE CONFIGURAÇÕES ---
function getSettings() {
    const defaultSettings = { diasEscopo: 1, senhaAdmin: "admin", ocultarIgnorados: true };

    try {
        // Tenta ler o arquivo
        if (fs.existsSync(SETTINGS_PATH)) {
            const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
            // Se o arquivo estiver vazio, força erro para cair no catch
            if (!content.trim()) throw new Error("Arquivo vazio");
            return JSON.parse(content);
        } else {
            throw new Error("Arquivo não existe");
        }
    } catch (e) {
        // SE DER QUALQUER ERRO (Não existe ou Corrompido):
        // Recria o arquivo com o padrão e retorna o padrão
        console.log("Recriando settings.json padrão...");
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2));
        return defaultSettings;
    }
}

function saveSettings(newSettings) {
    const current = getSettings();
    const updated = { ...current, ...newSettings };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
}

// Validador de telefone (Google LibPhoneNumber)
const PNF = require('google-libphonenumber').PhoneNumberFormat;
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

function prepararNumero(numeroBruto) {
    try {
        const numeroParseado = phoneUtil.parseAndKeepRawInput(numeroBruto, 'BR');

        if (!phoneUtil.isValidNumber(numeroParseado)) return null;
        return phoneUtil.format(numeroParseado, PNF.E164).replace('+', '');
    } catch (e) { return null; }
}

// Adicione esta função nova
function getOAuthClient() {
    if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error("CREDENTIALS_MISSING");

    
    const content = fs.readFileSync(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.web || keys.installed;


    // IMPORTANTE: Ajuste o domínio se necessário, mas mantenha o final /agenda/oauth2callback
    const redirectUri = 'https://consultoriobw.com.br/agenda/oauth2callback';


    return new google.auth.OAuth2(key.client_id, key.client_secret, redirectUri);
}

// Substitua a sua função carregarAuth antiga por esta versão simplificada
async function carregarAuth() {
    if (fs.existsSync(TOKEN_PATH)) {
        try {
            const client = getOAuthClient();
            const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
            client.setCredentials(token);
            return client;
        } catch (e) {
            console.log("Token inválido.");
        }
    }
    // Se não tiver token, lança erro para o frontend saber que precisa redirecionar
    throw new Error("AUTH_REQUIRED");
}

async function listarEventos(auth) {
    const calendar = google.calendar({ version: 'v3', auth });

    const settings = getSettings();
    const diasParaVer = settings.diasEscopo || 1;
    // O filtro (termo "ignorar" e "filtroAtivo") será tratado AGORA NO FRONT-END.
    // O backend sempre devolve TUDO para o período selecionado.

    const inicio = new Date();
    inicio.setDate(inicio.getDate() + 1); // Começa amanhã
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

    // NÃO FILTRAMOS MAIS AQUI. DEVOLVEMOS TUDO.
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
}

// --- 1. SISTEMA DE ALERTA HÍBRIDO (MAC & WINDOWS) ---
function mostrarErroFatal(titulo, mensagem) {
    const plataforma = process.platform; // Detecta se é 'darwin' (Mac) ou 'win32' (Windows)

    // Limpa quebras de linha para não quebrar o comando do terminal
    const msgLimpa = mensagem.replace(/"/g, "'").replace(/\n/g, " ");

    if (plataforma === 'darwin') {
        // --- MODO MAC ---
        // Usa AppleScript para mostrar o popup
        const comandoMac = `osascript -e 'display alert "${titulo}" message "${msgLimpa}" as critical'`;
        exec(comandoMac, (error) => {
            if (error) console.error("Falha ao abrir popup no Mac:", error);
        });
    } else if (plataforma === 'win32') {
        // --- MODO WINDOWS ---
        // Usa PowerShell para criar uma janela nativa do .NET
        const comandoWin = `powershell -Command "Add-Type -AssemblyName PresentationFramework;[System.Windows.MessageBox]::Show('${msgLimpa}','${titulo}')"`;
        exec(comandoWin, (error) => {
            if (error) console.error("Falha ao abrir popup no Windows:", error);
        });
    } else {
        // Fallback para Linux ou outros
        console.error(`[${titulo}] ${mensagem}`);
    }
}

// --- 2. CONFIGURAÇÕES DO SERVIDOR EXPRESS ---
// Configuração do Multer para upload de arquivos
const multer = require('multer');
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, DATA_FOLDER);
    },
    filename: function (req, file, cb) {
        // Força o nome para substituir os arquivos existentes
        if (file.fieldname === 'credenciais') cb(null, 'credentials.json');
        else if (file.fieldname === 'banco') cb(null, 'pacientes.json');
        else cb(new Error("Arquivo não permitido"), false);
    }
});
const upload = multer({ storage: storage });

// --- ROTAS EXPRESS ---
router.use(express.json());
router.use(express.static(path.join(__dirname, 'public')));

// 1. O Front pede o link de login
router.get('/api/auth-url', (req, res) => {
    try {
        const client = getOAuthClient();
        const url = client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent'
        });
        res.json({ url });
    } catch (e) {
        res.status(500).json({ error: "Erro no credentials.json" });
    }
});

// 2. O Google devolve o usuário aqui
router.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send("Erro: Sem código.");


    try {
        const client = getOAuthClient();
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        
        // Redireciona para a home da agenda
        res.redirect('/agenda'); 
    } catch (e) {
        res.send("Erro ao gerar token: " + e.message);
    }
});

router.get('/api/pacientes', (req, res) => {
    if (fs.existsSync(DB_PATH)) {
        res.json(JSON.parse(fs.readFileSync(DB_PATH)));
    } else {
        res.json({});
    }
});

router.post('/api/salvar', (req, res) => {
    try {
        const { nome, telefone } = req.body;
        const numeroLimpo = prepararNumero(telefone);

        if (!numeroLimpo) return res.status(400).json({ success: false, message: "Número inválido" });

        let db = {};
        if (fs.existsSync(DB_PATH)) db = JSON.parse(fs.readFileSync(DB_PATH));

        // Garante que o paciente seja um objeto para armazenar múltiplos dados
        if (typeof db[nome] !== 'object' || db[nome] === null) {
            db[nome] = {};
        }

        db[nome].telefone = numeroLimpo;
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/api/marcar-informado', (req, res) => {
    try {
        const { nome, informado } = req.body;

        let db = {};
        if (fs.existsSync(DB_PATH)) {
            db = JSON.parse(fs.readFileSync(DB_PATH));
        }

        // Garante que o paciente exista como um objeto no DB
        if (typeof db[nome] !== 'object' || db[nome] === null) {
            db[nome] = {};
        }

        db[nome].informadoEm = informado ? new Date() : null;

        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ROTA DE AGENDA REAL
router.get('/api/agenda', async (req, res) => {
    try {
        const auth = await carregarAuth();
        const eventos = await listarEventos(auth);
        res.json(eventos);
    } catch (e) {
        // ADICIONE ESTE BLOCO IF
        if (e.message === "AUTH_REQUIRED" || e.message.includes('invalid_grant')) {
            if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
            return res.status(401).json({ error: "AUTH_REQUIRED" });
        }
        // ... resto do seu tratamento de erro
        console.error(e);
        res.status(500).json({ error: "Erro ao buscar agenda: " + e.message });
    }
});
// Rotas de Configuração 
router.get('/api/settings', (req, res) => res.json(getSettings()));

router.post('/api/settings', (req, res) => {
    saveSettings(req.body);
    res.json({ success: true });
});

// Rota de Upload Drag & Drop 
const uploadFields = upload.fields([{ name: 'credenciais', maxCount: 1 }, { name: 'banco', maxCount: 1 }]);

router.post('/api/upload', (req, res) => {
    uploadFields(req, res, function (err) {
        if (err) return res.status(500).json({ success: false, message: err.message });

        // Verifica senha simples
        const { senha } = req.body;
        const settings = getSettings();

        if (senha !== settings.senhaAdmin) {
            return res.status(403).json({ success: false, message: "Senha incorreta!" });
        }

        res.json({ success: true, message: "Arquivo atualizado!" });
    });
});

router.post('/api/delete-token', (req, res) => {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }
        res.json({ success: true, message: "Token apagado com sucesso." });
    } catch (e) {
        console.error("Erro ao apagar token:", e);
        res.status(500).json({ success: false, message: "Erro interno ao tentar apagar o token." });
    }
});

getSettings();

const porta = 4040;

module.exports = router;