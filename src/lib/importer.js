import { Capacitor, registerPlugin } from '@capacitor/core';
import { parseGpsText } from './gpsio.js';
import { mergeWaypoints } from './waypoints.js';
import { getTracks } from './track.js';
import { saveTrack, loadTrackPoints } from './track.js';

// Stessa traccia = stessi punti (primo, ultimo, numero e distanza), indipendentemente dal nome
async function isDupTrack(tr) {
  const pts = tr.points || [];
  for (const x of getTracks()) {
    if (Math.abs((x.dist || 0) - (tr.dist || 0)) > 5) continue;
    if (x.start && tr.start && x.start === tr.start) return true;
    const ps = await loadTrackPoints(x.id);
    if (ps.length !== pts.length || !ps.length) continue;
    const a = ps[0], b = ps[ps.length - 1], c = pts[0], d = pts[pts.length - 1];
    const e = 2e-6;
    if (Math.abs(a[0] - c[0]) < e && Math.abs(a[1] - c[1]) < e && Math.abs(b[0] - d[0]) < e && Math.abs(b[1] - d[1]) < e) return true;
  }
  return false;
}
import { toast, openSheet } from './ui.js';

// files: [{ name, text }]
export async function importTexts(files) {
  let w = 0, t = 0, err = 0, dup = 0;
  for (const f of files) {
    try {
      if (/\.kmz$/i.test(f.name)) throw new Error('KMZ non supportato: esporta in KML');
      const r = parseGpsText(f.text, f.name);
      w += await mergeWaypoints(r.waypoints);
      dup += (await import('./waypoints.js')).lastDup;
      for (const tr of r.tracks) {
        if (await isDupTrack(tr)) { dup++; continue; }
        await saveTrack(tr);
        t++;
      }
    } catch (e) {
      err++;
      console.warn(f.name, e);
    }
  }
  const bad = err && !w && !t;
  const lines = bad
    ? ['Formato non riconosciuto o file vuoto.']
    : [`<b>${w}</b> waypoint importati`, `<b>${t}</b> tracce importate`, dup ? `${dup} già presenti, ignorati` : '', err ? `${err} file non letti` : ''].filter(Boolean);
  try {
    const sh = openSheet({
      title: bad ? 'Importazione non riuscita' : (w || t ? 'Importazione completata ✓' : 'Nessun dato nuovo'),
      body: `<div class="stack"><div style="line-height:1.9;font-size:1rem">${lines.join('<br>')}</div><button class="btn primary big" data-primary id="imp-ok">OK</button></div>`,
    });
    sh.body.querySelector('#imp-ok').onclick = () => sh.close();
  } catch {
    toast(lines.join(' · ').replace(/<[^>]+>/g, ''), 4200);
  }
  return { w, t, err };
}

// File aperti o condivisi con l'app (Garmin Explore, file manager)
export async function initIncomingFiles() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const IntentFiles = registerPlugin('IntentFiles');
    const go = (r) => r && r.files && r.files.length && importTexts(r.files);
    go(await IntentFiles.getPending());
    IntentFiles.addListener('files', go);
  } catch (e) {
    console.warn('IntentFiles', e);
  }
}
