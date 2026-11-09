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
    lateinit var dir: File
    var has by mutableStateOf(false)
    var minZ by mutableIntStateOf(0)
    var maxZ by mutableIntStateOf(0)
    var version by mutableIntStateOf(0)

    private val cache = LruCache<String, ImageBitmap>(48)
    private val pending: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val missing: MutableSet<String> = ConcurrentHashMap.newKeySet()

    fun init(c: Context) {
        dir = File(c.filesDir, "tiles")
        dir.mkdirs()
        scan()
    }

    fun scan() {
        val zs = dir.listFiles()?.filter { it.isDirectory }?.mapNotNull { it.name.toIntOrNull() } ?: emptyList()
        has = zs.isNotEmpty()
        if (has) {
            minZ = zs.min()
            maxZ = zs.max()
            if (AppState.zoom !in minZ..maxZ) AppState.zoom = AppState.zoom.coerceIn(minZ, maxZ)
        }
        cache.evictAll()
        missing.clear()
        version++
    }

    fun clear() {
        dir.deleteRecursively()
        dir.mkdirs()
        scan()
    }

    fun get(z: Int, x: Int, y: Int): ImageBitmap? {
        val key = "$z/$x/$y"
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
