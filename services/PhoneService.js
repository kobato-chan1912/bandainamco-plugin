const fs = require('fs');
const path = require('path');

const PHONES_FILE = path.join(__dirname, '../config/phones.txt');

function readPhones() {
    if (!fs.existsSync(PHONES_FILE)) return [];
    return fs.readFileSync(PHONES_FILE, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
}

function writePhones(phone, result) {
    const lines = readPhones();
    const idx = lines.findIndex(l => l === phone.trim());
    if (idx !== -1) {
        lines[idx] = `${phone.trim()}|${result}`;
    } else {
        lines.push(`${phone.trim()}|${result}`);
    }
    fs.writeFileSync(PHONES_FILE, lines.join('\n') + '\n', 'utf8');
}

function isPhoneProcessed(phone) {
    const phones = readPhones();
    return phones.some(l => {
        const p = l.split('|')[0];
        return p === phone.trim();
    });
}

function getPhoneResult(phone) {
    const phones = readPhones();
    for (const line of phones) {
        const [p, result] = line.split('|');
        if (p === phone.trim()) return result || null;
    }
    return null;
}

function getAllPhones() {
    return readPhones().map(l => {
        const [phone, result] = l.split('|');
        return { phone, result: result || null };
    });
}

module.exports = { writePhones, isPhoneProcessed, getPhoneResult, getAllPhones };
