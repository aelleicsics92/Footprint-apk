package it.footprint.trail.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipInputStream

/**
 * Protocollo con il telefono (Wearable Data Layer, via Bluetooth):
 *  - /fp/wp/{id}      DataItem waypoint (bidirezionale). Campi: id, icon, title, lat, lon, alt, acc, ts, dog, del
 *  - /fp/trip/{ts}    DataItem riepilogo uscita watch -> telefono (con Asset "track" gzip: lat,lon,alt,ts per riga)
 *  - canale /fp/tiles file ZIP di tile (z/x/y.png) telefono -> watch
 * I DataItem restano in coda su Play Services anche con il telefono offline e partono alla riconnessione.
 */
object Sync {
    const val WP = "/fp/wp/"
    const val TRIP = "/fp/trip/"
    const val TILES = "/fp/tiles"
    const val CONFIG = "/fp/config"
    const val BULK = "/fp/wps"
    const val TRACKS = "/fp/tracks"
    const val CMD = "/fp/cmd"
    const val LIVE = "/fp/live"

    /** Posizione e traccia in tempo reale per il telefono. */
    suspend fun pushLive(ctx: Context, on: Boolean) {
        try {
            val f = AppState.fix
            val o = org.json.JSONObject()
            o.put("on", on)
            o.put("ts", System.currentTimeMillis())
            o.put("dist", AppState.distance)
            o.put("start", AppState.startTs)
            if (f != null) { o.put("lat", f.lat); o.put("lon", f.lon); o.put("alt", f.alt) }
            val pts = AppState.track.toList()
            val step = (pts.size / 500) + 1
            val sb = StringBuilder()
            pts.forEachIndexed { i, p -> if (i % step == 0 || i == pts.size - 1) sb.append(p.lat).append(',').append(p.lon).append('\n') }
            val bos = ByteArrayOutputStream()
            GZIPOutputStream(bos).use { it.write(sb.toString().toByteArray()) }
            val req = PutDataMapRequest.create(LIVE)
            req.dataMap.putString("json", o.toString())
            req.dataMap.putAsset("track", Asset.createFromBytes(bos.toByteArray()))
            Wearable.getDataClient(ctx).putDataItem(req.asPutDataRequest()).await()
        } catch (e: Exception) {
        }
    }

    /** Tracce salvate sul telefono, da mostrare sulla mappa del watch. */
    suspend fun applyTracks(ctx: Context, asset: Asset) {
        val fd = Wearable.getDataClient(ctx).getFdForAsset(asset).await()
        val text = java.util.zip.GZIPInputStream(fd.inputStream).bufferedReader().use { it.readText() }
        File(ctx.filesDir, "tracks.json").writeText(text)
        val list = parseTracks(text)
        withContext(Dispatchers.Main) {
            AppState.saved.clear()
            AppState.saved.addAll(list)
            Controls.toast("Tracce dal telefono: ${list.size}")
        }
    }

    fun parseTracks(text: String): List<List<LL>> {
        val arr = org.json.JSONArray(text)
        val out = ArrayList<List<LL>>()
        for (i in 0 until arr.length()) {
            val a = arr.getJSONObject(i).getJSONArray("p")
            val l = ArrayList<LL>(a.length() / 2)
            var j = 0
            while (j + 1 < a.length()) { l.add(LL(a.getDouble(j), a.getDouble(j + 1))); j += 2 }
            if (l.size > 1) out.add(l)
        }
        return out
    }

    /** Comandi dal telefono (es. elimina una mappa). Ogni comando ha un ts: i DataItem rimandati non si rieseguono. */
    suspend fun applyCmd(ctx: Context, json: String) {
        val o = org.json.JSONObject(json)
        val ts = o.optLong("ts")
        if (ts <= AppState.sp.getLong("cmdTs", 0L)) return
        AppState.sp.edit().putLong("cmdTs", ts).apply()
        when (o.optString("op")) {
            "delmap" -> {
                val id = o.optString("id")
                val lst = File(File(ctx.filesDir, "maps"), "$id.lst")
                if (lst.exists()) {
                    val root = TileCache.dir.canonicalFile
                    lst.readLines().forEach { rel ->
                        val f = File(root, rel).canonicalFile
                        if (f.path.startsWith(root.path + File.separator)) f.delete()
                    }
                    lst.delete()
                }
                Status.removeMap(id)
                withContext(Dispatchers.Main) {
                    TileCache.scan()
                    Controls.toast("Mappa eliminata")
                }
            }
            "clearmaps" -> {
                TileCache.clear()
                Status.clearMaps()
                withContext(Dispatchers.Main) { Controls.toast("Mappe eliminate") }
            }
        }
        Status.push(ctx)
    }

    suspend fun push(ctx: Context, w: Waypoint) {
        try {
            val req = PutDataMapRequest.create(WP + w.id)
            val m = req.dataMap
            m.putString("id", w.id)
            m.putString("icon", w.icon)
            m.putString("title", w.title)
            m.putDouble("lat", w.lat)
            m.putDouble("lon", w.lon)
            m.putDouble("alt", w.alt)
            m.putFloat("acc", w.acc)
            m.putLong("ts", w.ts)
            m.putBoolean("dog", w.dog)
            m.putBoolean("del", w.deleted)
            m.putLong("mod", System.currentTimeMillis())
            Wearable.getDataClient(ctx).putDataItem(req.asPutDataRequest().setUrgent()).await()
            Store.db.markSynced(w.id)
        } catch (e: Exception) {
            // Play Services non disponibile: resta non sincronizzato e riparte al prossimo avvio
        }
    }

    suspend fun pushAllUnsynced(ctx: Context) {
        for (w in Store.db.unsynced()) push(ctx, w)
    }

    suspend fun pushTrip(ctx: Context, startTs: Long, dist: Double, up: Double, down: Double, maxSpeed: Float, pts: List<TrackPt>) {
        try {
            val sb = StringBuilder()
            for (p in pts) sb.append(p.lat).append(',').append(p.lon).append(',').append(p.alt).append(',').append(p.ts).append('\n')
            val bos = ByteArrayOutputStream()
            GZIPOutputStream(bos).use { it.write(sb.toString().toByteArray()) }
            val req = PutDataMapRequest.create(TRIP + startTs)
            val m = req.dataMap
            m.putLong("start", startTs)
            m.putLong("end", System.currentTimeMillis())
            m.putDouble("dist", dist)
            m.putDouble("up", up)
            m.putDouble("down", down)
            m.putFloat("maxSpeed", maxSpeed)
            m.putAsset("track", Asset.createFromBytes(bos.toByteArray()))
            Wearable.getDataClient(ctx).putDataItem(req.asPutDataRequest().setUrgent()).await()
        } catch (e: Exception) {
        }
    }

    /** Applica un waypoint arrivato dal telefono (o rimbalzato dal watch stesso: operazione idempotente). */
    suspend fun applyRemote(w: Waypoint) {
        withContext(Dispatchers.Main) {
            val i = AppState.waypoints.indexOfFirst { it.id == w.id }
            if (w.deleted) {
                if (i >= 0) AppState.waypoints.removeAt(i)
            } else if (i >= 0) {
                AppState.waypoints[i] = w
            } else {
                AppState.waypoints.add(w)
            }
        }
        if (w.deleted) Store.db.softDelete(w.id, true) else Store.db.upsert(w)
    }

    /** Impostazioni scelte dal telefono: le 10 icone del menu a ruota e le preferenze. */
    suspend fun applyConfig(json: String) {
        val o = org.json.JSONObject(json)
        withContext(Dispatchers.Main) {
            val ic = o.optJSONArray("icons")
            if (ic != null && ic.length() > 0) {
                val l = ArrayList<String>()
                for (i in 0 until ic.length()) l.add(ic.getString(i))
                val ten = l.take(12)
                AppState.icons.clear()
                AppState.icons.addAll(ten)
                AppState.putStr("icons", ten.joinToString(","))
                if (AppState.lastType !in ten) {
                    AppState.lastType = ten.first()
                    AppState.putStr("lastType", ten.first())
                }
            }
            if (o.has("keyMode")) { AppState.keyMode = o.getInt("keyMode"); AppState.putInt("keyMode", AppState.keyMode) }
            if (o.has("theme")) { AppState.theme = o.getInt("theme"); AppState.putInt("theme", AppState.theme) }
            if (o.has("prox")) { AppState.proxM = o.getInt("prox"); AppState.putInt("proxM", AppState.proxM) }
            if (o.has("offM")) { AppState.offM = o.getInt("offM"); AppState.putInt("offM", AppState.offM) }
            if (o.has("rot")) { AppState.rotaryPx = o.getDouble("rot").toFloat(); AppState.putFloat("rot", AppState.rotaryPx) }
            if (o.has("tscale")) { AppState.tileScale = o.getDouble("tscale").toFloat(); AppState.putFloat("tscale", AppState.tileScale) }
            if (o.has("lock")) { AppState.touchLock = o.getBoolean("lock"); AppState.putBool("lock", AppState.touchLock) }
            Controls.toast("Impostazioni dal telefono")
        }
    }

    /** Elenco completo dei waypoint del telefono (JSON gzip in un Asset). I punti spariti dal telefono si tolgono anche qui. */
    suspend fun applyBulk(ctx: Context, asset: Asset) {
        val fd = Wearable.getDataClient(ctx).getFdForAsset(asset).await()
        val text = java.util.zip.GZIPInputStream(fd.inputStream).bufferedReader().use { it.readText() }
        val arr = org.json.JSONArray(text)
        val list = ArrayList<Waypoint>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            list.add(
                Waypoint(
                    o.getString("id"), o.optString("icon", "fungo"), o.optString("title", ""),
                    o.getDouble("lat"), o.getDouble("lon"), o.optDouble("alt", 0.0), o.optDouble("acc", 0.0).toFloat(),
                    o.optLong("ts"), o.optBoolean("dog"), synced = true
                )
            )
        }
        val newIds = list.map { it.id }.toSet()
        val prev: Set<String> = HashSet(AppState.sp.getStringSet("phoneIds", emptySet()) ?: emptySet())
        val gone = prev - newIds
        Store.db.bulkUpsert(list)
        for (id in gone) Store.db.softDelete(id, true)
        AppState.sp.edit().putStringSet("phoneIds", newIds).apply()
        withContext(Dispatchers.Main) {
            val byId = list.associateBy { it.id }
            val keep = AppState.waypoints.toList().filter { it.id !in gone && it.id !in byId }
            AppState.waypoints.clear()
            AppState.waypoints.addAll(keep + list.sortedBy { it.ts })
            Controls.toast("Waypoint dal telefono: ${list.size}")
        }
    }

    fun fromMap(m: DataMap): Waypoint? {
        val id = m.getString("id") ?: return null
        return Waypoint(
            id = id,
            icon = m.getString("icon") ?: "fungo",
            title = m.getString("title") ?: "",
            lat = m.getDouble("lat"),
            lon = m.getDouble("lon"),
            alt = m.getDouble("alt"),
            acc = m.getFloat("acc"),
            ts = m.getLong("ts"),
            dog = m.getBoolean("dog"),
            synced = true,
            deleted = m.getBoolean("del")
        )
    }
}

class SyncService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        val items = ArrayList<Waypoint>()
        var cfg: String? = null
        var bulk: Asset? = null
        var tracks: Asset? = null
        var cmd: String? = null
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED) continue
            val path = e.dataItem.uri.path ?: continue
            val map = DataMapItem.fromDataItem(e.dataItem).dataMap
            when {
                path == Sync.CONFIG -> cfg = map.getString("json")
                path == Sync.BULK -> bulk = map.getAsset("data")
                path == Sync.TRACKS -> tracks = map.getAsset("data")
                path == Sync.CMD -> cmd = map.getString("json")
                path.startsWith(Sync.WP) -> Sync.fromMap(map)?.let { items.add(it) }
            }
        }
        val ctx = applicationContext
        AppState.scope.launch {
            try { cfg?.let { Sync.applyConfig(it) } } catch (e: Exception) { }
            try { bulk?.let { Sync.applyBulk(ctx, it) } } catch (e: Exception) { }
            try { tracks?.let { Sync.applyTracks(ctx, it) } } catch (e: Exception) { }
            try { cmd?.let { Sync.applyCmd(ctx, it) } } catch (e: Exception) { }
            for (w in items) Sync.applyRemote(w)
        }
    }

    override fun onChannelOpened(ch: ChannelClient.Channel) {
        if (ch.path != Sync.TILES) return
        val tmp = File(cacheDir, "tiles.zip")
        AppState.scope.launch(Dispatchers.Main) { Controls.toast("Ricevo mappe...") }
        Wearable.getChannelClient(this).receiveFile(ch, Uri.fromFile(tmp), false)
    }

    override fun onInputClosed(ch: ChannelClient.Channel, closeReason: Int, appSpecificErrorCode: Int) {
        if (ch.path != Sync.TILES) return
        val tmp = File(cacheDir, "tiles.zip")
        if (closeReason != ChannelClient.ChannelCallback.CLOSE_REASON_NORMAL || !tmp.exists()) {
            AppState.scope.launch(Dispatchers.Main) { Controls.toast("Mappe: ricezione interrotta") }
            return
        }
        AppState.scope.launch(Dispatchers.IO) {
            val files = ArrayList<String>()
            val (n, metaId) = unzipTiles(tmp, TileCache.dir, files)
            tmp.delete()
            if (metaId != null) {
                Status.addMap(metaId, n)
                val md = File(filesDir, "maps")
                md.mkdirs()
                File(md, "$metaId.lst").writeText(files.joinToString("\n"))
            }
            withContext(Dispatchers.Main) {
                TileCache.scan()
                Controls.toast("Mappe ricevute: $n tile")
            }
            Status.push(applicationContext)
        }
    }

    /** Ritorna (numero di tile, id area dal file meta.json). */
    private fun unzipTiles(zip: File, dest: File, files: MutableList<String>): Pair<Int, String?> {
        val rx = Regex("^(?:tiles/)?(\\d{1,2})/(\\d+)/(\\d+)\\.(png|jpg|jpeg|webp)$")
        val root = dest.canonicalFile
        var n = 0
        var metaId: String? = null
        ZipInputStream(zip.inputStream().buffered()).use { zin ->
            var e = zin.nextEntry
            while (e != null) {
                if (!e.isDirectory) {
                    val m = rx.matchEntire(e.name)
                    if (e.name == "meta.json") {
                        metaId = try { org.json.JSONObject(zin.readBytes().toString(Charsets.UTF_8)).optString("id").ifEmpty { null } } catch (x: Exception) { null }
                    } else if (m != null) {
                        val ext = if (m.groupValues[4] == "jpeg") "jpg" else m.groupValues[4]
                        val f = File(root, "${m.groupValues[1]}/${m.groupValues[2]}/${m.groupValues[3]}.$ext").canonicalFile
                        if (f.path.startsWith(root.path + File.separator)) {
                            f.parentFile?.mkdirs()
                            f.outputStream().use { out -> zin.copyTo(out) }
                            n++
                            files.add("${m.groupValues[1]}/${m.groupValues[2]}/${m.groupValues[3]}.$ext")
                        }
                    }
                }
                zin.closeEntry()
                e = zin.nextEntry
            }
        }
        return Pair(n, metaId)
    }
}
