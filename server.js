
const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');

const app = express();

// --- CONFIGURAÇÕES DO GOOGLE ---
// Escopos: Que permissão precisamos? Apenas ler eventos.
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// Define a pasta onde os dados sensíveis ficam
const DATA_FOLDER = path.join(process.cwd(), 'dados');

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

// Autenticação: Carrega token salvo ou pede novo login
async function carregarAuth() {
    // 1. Verificação de Segurança: O credentials.json existe?
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        throw new Error("Arquivo 'credentials.json' ausente. Vá em Configurações e faça o upload.");
    }

    // 2. Lê as credenciais do App (O "Crachá" do Programa)
    let keys;
    try {
        const fileContent = fs.readFileSync(CREDENTIALS_PATH);
        const json = JSON.parse(fileContent);

        // O Google pode salvar como 'installed' ou 'web', pegamos qual tiver
        keys = json.installed || json.web;
        if (!keys) throw new Error("Formato inválido");
    } catch (e) {
        throw new Error("Arquivo 'credentials.json' corrompido/inválido.");
    }

    // 3. Monta o Cliente Oficial com o Crachá
    // Isso garante que o Google saiba QUEM está pedindo (Identity)
    const client = new google.auth.OAuth2(
        keys.client_id,
        keys.client_secret,
        keys.redirect_uris ? keys.redirect_uris[0] : 'http://localhost'
    );

    // 4. Agora sim, verificamos se já temos o token do Usuário
    if (fs.existsSync(TOKEN_PATH)) {
        try {
            const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
            client.setCredentials(token);
            return client; // Retorna o cliente já montado e logado
        } catch (e) {
            console.log("Token antigo inválido/ilegível. Vamos gerar um novo.");
        }
    }

    // 5. Se não tem token (ou estava ruim), abre o navegador para logar
    console.log("Iniciando novo login via navegador...");

    // Usamos a lib auxiliar apenas para facilitar o fluxo de abrir janela
    const localAuth = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });

    // Pega as credenciais que a lib conseguiu e salva
    if (localAuth.credentials) {
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(localAuth.credentials));
        // Aplica no nosso cliente manual para garantir a consistência
        client.setCredentials(localAuth.credentials);
    }

    return client;
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/pacientes', (req, res) => {
    if (fs.existsSync(DB_PATH)) {
        res.json(JSON.parse(fs.readFileSync(DB_PATH)));
    } else {
        res.json({});
    }
});

app.post('/api/salvar', (req, res) => {
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

app.post('/api/marcar-informado', (req, res) => {
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
app.get('/api/agenda', async (req, res) => {
    try {
        const auth = await carregarAuth();
        const eventos = await listarEventos(auth);
        res.json(eventos);
    } catch (e) {
        console.error(e);
        // Se der erro de autenticação, apagamos o token para forçar login na próxima
        if (e.message.includes('invalid_grant')) {
            if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
        }
        res.status(500).json({ error: "Erro ao buscar agenda: " + e.message });
    }
});
// Rotas de Configuração 
app.get('/api/settings', (req, res) => res.json(getSettings()));

app.post('/api/settings', (req, res) => {
    saveSettings(req.body);
    res.json({ success: true });
});

// Rota de Upload Drag & Drop 
const uploadFields = upload.fields([{ name: 'credenciais', maxCount: 1 }, { name: 'banco', maxCount: 1 }]);

app.post('/api/upload', (req, res) => {
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

getSettings();

// --- INICIALIZAÇÃO (MANTIDA A CORREÇÃO DO IMPORT DINÂMICO) ---
const servidor = app.listen(0, async () => {
    const porta = servidor.address().port;
    console.log(`Servidor na porta: ${porta}`);

    // Solução híbrida para o 'open' (compatível v8 ou v11)
    let open;
    try {
        open = require('open'); // Tenta CommonJS
    } catch {
        open = (await import('open')).default; // Fallback para ESM
    }

    open(`http://localhost:${porta}`).catch(e => mostrarErroFatal("Erro", "Falha ao abrir navegador"));
});