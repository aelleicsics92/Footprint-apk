import { Capacitor, registerPlugin } from '@capacitor/core';
import { parseGpsText } from './gpsio.js';
import { mergeWaypoints } from './waypoints.js';
import { getTracks } from './track.js';
import { saveTrack } from './track.js';
import { toast } from './ui.js';

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
        if (getTracks().some((x) => x.start && x.start === tr.start && Math.abs((x.dist || 0) - (tr.dist || 0)) < 5)) { dup++; continue; }
        await saveTrack(tr);
        t++;
      }
    } catch (e) {
      err++;
      console.warn(f.name, e);
    }
  }
  toast(err && !w && !t ? 'Formato non riconosciuto' : `Importati ${w} waypoint e ${t} tracce${dup ? ` · ${dup} già presenti, ignorati` : ''}${err ? ` (${err} file non letti)` : ''}`, 4200);
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
