package it.footprint.trail.wear

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** Tile raster salvati in files/tiles/{z}/{x}/{y}.png|jpg|webp (inviati dal telefono). */
object TileCache {
    lateinit var root: File
    /** Cartella dello strato scelto (sat o topo): files/tiles/{strato}/{z}/{x}/{y}.png */
    val dir: File get() = File(root, AppState.mapSrc)
    var has by mutableStateOf(false)
    var srcs by mutableStateOf<Set<String>>(emptySet())
    var minZ by mutableIntStateOf(0)
    var maxZ by mutableIntStateOf(0)
    var version by mutableIntStateOf(0)

    private val cache = LruCache<String, ImageBitmap>(48)
    private val pending: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val missing: MutableSet<String> = ConcurrentHashMap.newKeySet()

    fun init(c: Context) {
        root = File(c.filesDir, "tiles")
        root.mkdirs()
        migrate(c)
        scan()
    }

    /** Vecchie versioni salvavano i tile senza strato: si spostano in "sat" (e si aggiornano elenco file e stato). */
    private fun migrate(c: Context) {
        val old = root.listFiles()?.filter { it.isDirectory && it.name.toIntOrNull() != null } ?: emptyList()
        if (old.isNotEmpty()) {
            val d = File(root, "sat")
            d.mkdirs()
            old.forEach { it.renameTo(File(d, it.name)) }
        }
        val md = File(c.filesDir, "maps")
        val legacy = md.listFiles()?.filter { it.isFile && it.name.endsWith(".lst") } ?: emptyList()
        if (legacy.isNotEmpty()) {
            val sd = File(md, "sat")
            sd.mkdirs()
            for (f in legacy) {
                File(sd, f.name).writeText(f.readLines().filter { it.isNotBlank() }.joinToString("\n") { "sat/$it" })
                f.delete()
            }
        }
        val raw = AppState.sp.getString("maps", "{}") ?: "{}"
        val o = org.json.JSONObject(raw)
        val keys = ArrayList<String>()
        o.keys().forEach { keys.add(it) }
        var ch = false
        for (k in keys) if (!k.contains("|")) { o.put("$k|sat", o.get(k)); o.remove(k); ch = true }
        if (ch) AppState.sp.edit().putString("maps", o.toString()).apply()
    }

    fun scan() {
        srcs = listOf("sat", "topo").filter { File(root, it).list()?.isNotEmpty() == true }.toSet()
        val zs = dir.listFiles()?.filter { it.isDirectory }?.mapNotNull { it.name.toIntOrNull() } ?: emptyList()
        has = zs.isNotEmpty()
        if (has) {
            minZ = zs.min()
            maxZ = zs.max()
            val hi = (maxZ + 3).coerceAtMost(17).coerceAtLeast(maxZ)
            if (AppState.zoom !in minZ..hi) AppState.zoom = AppState.zoom.coerceIn(minZ, hi)
        }
        cache.evictAll()
        missing.clear()
        version++
    }

    fun clear() {
        root.deleteRecursively()
        root.mkdirs()
        scan()
    }

    fun get(z: Int, x: Int, y: Int): ImageBitmap? {
        val key = "${AppState.mapSrc}/$z/$x/$y"
        cache.get(key)?.let { return it }
        if (key in missing) return null
        if (pending.add(key)) {
            AppState.scope.launch(Dispatchers.IO) {
                var bmp: ImageBitmap? = null
                for (ext in arrayOf("png", "jpg", "webp")) {
                    val f = File(dir, "$z/$x/$y.$ext")
                    if (f.exists()) {
                        bmp = BitmapFactory.decodeFile(f.absolutePath)?.asImageBitmap()
                        if (bmp != null) break
                    }
                }
                if (bmp != null) cache.put(key, bmp) else missing.add(key)
                pending.remove(key)
                version++
            }
        }
        return null
    }
}
