'use strict';

const Tariffs = require('./tariffs');
const SEDE = Tariffs.SEDE;
function cityId(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}
function findCity(cities, name) {
  const wanted = cityId(name);
  return Object.entries(cities || {}).find(([id, city]) => id === wanted || cityId(city?.name) === wanted)?.[1] || null;
}
function configure(input, existing, now) {
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100 || /[.#$\[\]/]/.test(name)) throw Error('Informe um nome de cidade válido.');
  const id = cityId(input.cityId || name);
  if (!id) throw Error('Identificador de cidade inválido.');
  const timezone = String(input.timezone || 'America/Sao_Paulo');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(now); }
  catch { throw Error('Fuso horário inválido.'); }
  const baseFee = Number(input.baseFee);
  if (!Number.isFinite(baseFee) || baseFee < 1 || baseFee > 10000 || Math.round(baseFee * 100) !== baseFee * 100) throw Error('A tarifa-base deve estar entre R$ 1,00 e R$ 10.000,00.');
  const nightFee = input.nightFee === undefined || input.nightFee === '' ? baseFee : Number(input.nightFee);
  if (!Number.isFinite(nightFee) || nightFee < 1 || nightFee > 10000 || Math.round(nightFee * 100) !== nightFee * 100) throw Error('A tarifa noturna deve estar entre R$ 1,00 e R$ 10.000,00.');
  const zones = { [SEDE]: baseFee };
  const seenZones = new Set();
  const zoneRates = input.zoneRates && typeof input.zoneRates === 'object' && !Array.isArray(input.zoneRates) ? input.zoneRates : {};
  if (Object.keys(zoneRates).length > 99) throw Error('Cadastre no máximo 99 bairros por cidade.');
  for (const [rawName, rawFee] of Object.entries(zoneRates)) {
    const zone = String(rawName).trim().replace(/\s+/g, ' ');
    const normalized = cityId(zone);
    const fee = Number(rawFee);
    if (!zone || zone.length > 120 || /[.#$\[\]/]/.test(zone) || !normalized || normalized === cityId(SEDE) || seenZones.has(normalized)) throw Error('Confira os nomes dos bairros; cada bairro precisa ser válido e único.');
    if (!Number.isFinite(fee) || fee < 1 || fee > 10000 || Math.round(fee * 100) !== fee * 100) throw Error('Informe uma tarifa válida para ' + zone + '.');
    seenZones.add(normalized);
    zones[zone] = fee;
  }
  const rates = {
    schemaVersion: 1,
    timezone,
    zones,
    sedeDay: baseFee,
    sedeNight: nightFee,
    rainSede: 0,
    night: 0,
    bag: 0,
    bankService: 0,
    cardMinimum: 0,
    lateMinimum: baseFee
  };
  return { id, city: { id, name, enabled: input.enabled !== false, timezone, rates, updatedAt: now, ...(existing?.createdAt ? { createdAt: existing.createdAt } : { createdAt: now }) } };
}
function resolve(cities, name, existingCityId) {
  const city = findCity(cities, name);
  if (city) return city.enabled === true || city.id === existingCityId ? city : null;
  if (!Object.keys(cities || {}).length || cityId(name) === 'aracruz') return { id: 'aracruz', name: 'Aracruz', enabled: true, legacy: true };
  return null;
}

module.exports = { cityId, findCity, configure, resolve, SEDE };
