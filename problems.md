# Relatório de Problemas e Melhorias Técnicas

Este documento lista práticas de arquitetura, segurança e performance identificadas no código.

## 1. Performance e Escalabilidade

### ✅ [RESOLVIDO] I/O Síncrono Bloqueante
- **Status:** O código foi refatorado para usar `fs.promises` e `async/await`. O servidor não bloqueia mais o Event Loop durante operações de disco.

### ✅ [RESOLVIDO] Concorrência e Race Conditions
- **Status:** Implementado sistema de **Mutex** (`src/mutex.js`) para controlar o acesso de escrita aos arquivos `pacientes.json` e `settings.json`. As operações de leitura-modificação-escrita agora são seguras.

## 2. Segurança (Prioridade Alta)

### ❌ [NÃO RESOLVIDO] Armazenamento de Credenciais
- **Problema:** A senha de administração é salva em texto plano no arquivo `settings.json` e comparada diretamente no código.
- **Risco:** Vulnerabilidade crítica se o arquivo for exposto.
- **Recomendação:** Implementar Hash de senha (usando `crypto.scrypt` nativo do Node.js ou `bcrypt`).

### ❌ [NÃO RESOLVIDO] Autenticação Simples
- **Problema:** Ausência de proteção contra força bruta (Rate Limiting).
- **Risco:** Um atacante pode tentar senhas infinitamente na rota `/api/upload`.
- **Recomendação:** Implementar middleware de limitação de tentativas.

## 3. Estabilidade e Tratamento de Erros

### ✅ [RESOLVIDO] Remoção Agressiva de Tokens
- **Status:** A lógica de remoção do `token.json` foi refinada em `src/googleService.js`. O token só é removido se o Google retornar erros explícitos de `invalid_grant` ou `invalid_token`.

## 4. Manutenibilidade do Código

### ⚠️ [PARCIAL] Mistura de Responsabilidades
- **Status:** O arquivo "Deus" `server.js` foi refatorado e dividido em módulos (`config.js`, `database.js`, `googleService.js`).
- **Pendente:** A função `listarEventos` em `src/googleService.js` ainda mistura lógica de busca de dados com formatação de data (View Logic).