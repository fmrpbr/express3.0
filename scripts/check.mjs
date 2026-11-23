import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const html = readFileSync('www/index.html', 'utf8');
const release = JSON.parse(readFileSync('release.json', 'utf8'));
if (!html.includes(`const APP_VERSION="${release.version}";`) || !html.includes(`Versão ${release.version}`)) throw Error('Versões da interface divergentes.');
if (readFileSync('firebase.json', 'utf8').includes('"hosting"')) throw Error('O pacote do site não deve configurar um destino de Hosting.');
for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) if (script[1].trim()) new vm.Script(script[1]);
execFileSync(process.execPath, ['--check', 'www/admin-dashboard.js']);
for (const file of ['domain.js', 'durations.js', 'records.js', 'cities.js', 'external-integrations.js', 'logistics.js', 'return-scheduler.js', 'payments.js', 'tariffs.js', 'tariff-scheduler.js', 'offer-distribution.js', 'commands.js', 'notifications.js', 'notification-tools.js', 'notification-policy.js', 'index.js']) execFileSync(process.execPath, ['--check', 'functions/' + file]);
JSON.parse(readFileSync('database.rules.json', 'utf8'));
if (/(?:onValue|once)\(ref\(db, ["`]orders["`]\)/.test(html)) throw Error('Leitura global no cliente.');
if (/(?:set|update|runTransaction)\(ref\(db, ["`]orders/.test(html)) throw Error('Gravação direta de pedido.');
console.log('Versão, sintaxe, regras JSON e limites de acesso do site: OK');
