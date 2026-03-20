const PNF = require('google-libphonenumber').PhoneNumberFormat;
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

/**
 * Formata um número de telefone para o padrão E.164 (sem o +).
 * Retorna null se inválido.
 */
function prepararNumero(numeroBruto) {
    try {
        if (!numeroBruto) return null;
        const numeroParseado = phoneUtil.parseAndKeepRawInput(numeroBruto, 'BR');

        if (!phoneUtil.isValidNumber(numeroParseado)) return null;
        return phoneUtil.format(numeroParseado, PNF.E164).replace('+', '');
    } catch (e) { 
        return null; 
    }
}

module.exports = { prepararNumero };