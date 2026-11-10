package it.footprint.trail.wear

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.StatFs
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.io.File

/** Stato dell'orologio per il telefono: batteria, memoria, mappe presenti. Ripubblicato quando cambia qualcosa. */
object Status {
    private fun dirSize(f: File): Long {
        if (f.isFile) return f.length()
        var n = 0L
        f.listFiles()?.forEach { n += dirSize(it) }
        return n
    }

    fun tilesBytes(): Long = dirSize(TileCache.dir)

    suspend fun push(ctx: Context) {
        try {
            val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val bat = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            val st = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val s = st?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val chg = s == BatteryManager.BATTERY_STATUS_CHARGING || s == BatteryManager.BATTERY_STATUS_FULL
            val sf = StatFs(ctx.filesDir.path)
            val o = JSONObject()
            o.put("model", Build.MODEL)
            o.put("bat", bat)
            o.put("chg", chg)
            o.put("free", sf.availableBytes)
            o.put("total", sf.totalBytes)
            o.put("tiles", tilesBytes())
            o.put("maps", AppState.sp.getString("maps", "{}") ?: "{}")
            o.put("ts", System.currentTimeMillis())
            val req = PutDataMapRequest.create("/fp/status")
            req.dataMap.putString("json", o.toString())
            Wearable.getDataClient(ctx).putDataItem(req.asPutDataRequest().setUrgent()).await()
        } catch (e: Exception) {
        }
    }

    /** Registra una mappa ricevuta (id area dal telefono). */
    fun addMap(id: String, count: Int) {
        val o = JSONObject(AppState.sp.getString("maps", "{}") ?: "{}")
        o.put(id, count)
        AppState.sp.edit().putString("maps", o.toString()).apply()
    }

    fun removeMap(id: String) {
        val o = JSONObject(AppState.sp.getString("maps", "{}") ?: "{}")
        o.remove(id)
        AppState.sp.edit().putString("maps", o.toString()).apply()
    }

    fun clearMaps() {
        AppState.sp.edit().remove("maps").apply()
        File(FpApp.ctx.filesDir, "maps").deleteRecursively()
    }
}
