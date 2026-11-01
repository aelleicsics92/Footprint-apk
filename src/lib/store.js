import { get, set, del, keys, createStore } from 'idb-keyval';

const kv = createStore('fp-data', 'kv');
export const tileStore = createStore('fp-tiles', 'tiles');
export const kvGet = (k) => get(k, kv);
export const kvSet = (k, v) => set(k, v, kv);
export const kvDel = (k) => del(k, kv);
export const kvKeys = () => keys(kv);

const ENV = import.meta.env || {};
const DEFAULTS = {
  hiContrast: false,
  altOn: false, altMin: 800, altMax: 1200, wpTag: '',
  permitExpiry: '', permitName: '', dogChip: '', dogVaccine: '', dogParasite: '', dogVet: '', manDown: false,
  volumeWp: false,
  sosNumber: '112',
  sosName: 'Emergenze',
  declination: 3.5,
  keepAwake: true,
  keepAlive: true,
  geminiKey: '',
  openrouterKey: '',
  groqKey: '',
  geminiModel: 'gemini-3.5-flash',
  openrouterModel: 'google/gemma-3-27b-it:free',
  groqModel: 'openai/gpt-oss-120b',
  baseLayer: 'sat',
  overlayTrails: true,
  showWaypoints: true,
  wpCounter: 0,
  fungiProfile: 'autunnali',
  mapProfile: 'autunnali',
  notifFungi: false,
  offTrackM: 80,
  wpYear: '',
  wpMonth: 0,
  nightMode: false,
  sunsetAlert: true,
  showHeat: false,
  showExplored: false,
  showNoSignal: false,
  statusNotif: false,
  dogName: '',
  wpOrder: [],
  wpHidden: [],
  iceBlood: '',
  iceAllergies: '',
  icePhone: '',
};

let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('fp.settings') || '{}') };
  // migrazione: il vecchio modello Groq predefinito non esiste più
  if (/llama-4-scout/.test(settings.groqModel || '')) settings.groqModel = DEFAULTS.groqModel;
  if (settings.fungiProfile === 'tartufi') settings.fungiProfile = 'uncinato';
  if (/latest|gemini-(1|2)\./.test(settings.geminiModel || '')) settings.geminiModel = DEFAULTS.geminiModel;
} catch {}

export const getSettings = () => settings;
export function setSetting(key, value) {
  settings[key] = value;
  try {
    localStorage.setItem('fp.settings', JSON.stringify(settings));
  } catch {}
}
// profili dei cani: [{id,name,chip,vax,par,vet}]; migra i vecchi campi singoli
export function getDogs() {
  if (!Array.isArray(settings.dogs)) {
    const names = String(settings.dogName || '').split(',').map((x) => x.trim()).filter(Boolean);
    const list = names.map((n, i) => ({ id: 'd' + i, name: n, chip: i ? '' : settings.dogChip || '', vax: i ? '' : settings.dogVaccine || '', par: i ? '' : settings.dogParasite || '', vet: i ? '' : settings.dogVet || '' }));
    if (!list.length && (settings.dogChip || settings.dogVaccine || settings.dogParasite || settings.dogVet)) list.push({ id: 'd0', name: '', chip: settings.dogChip || '', vax: settings.dogVaccine || '', par: settings.dogParasite || '', vet: settings.dogVet || '' });
    settings.dogs = list;
  }
  return settings.dogs.map((d) => ({ ...d }));
}
export function setDogs(list) {
  setSetting('dogs', list);
  setSetting('dogName', list.map((d) => d.name).filter(Boolean).join(', '));
  try { window.dispatchEvent(new CustomEvent('fp:dogs')); } catch {}
}
export function apiKey(name) {
  const own = settings[name + 'Key'];
  if (own && own.trim()) return own.trim();
  return (ENV['VITE_' + name.toUpperCase() + '_API_KEY'] || '').trim();
}
export const lsGet = (k, d = null) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
export const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
