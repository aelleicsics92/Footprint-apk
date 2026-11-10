package it.footprint.trail.wear

import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/** Le stesse icone waypoint dell'app del telefono (PNG in res/drawable-nodpi/wp_<id>.png). */
object Icons {
    private val cache = HashMap<String, ImageBitmap?>()

    fun get(id: String): ImageBitmap? = synchronized(cache) {
        cache.getOrPut(id) {
            val c = FpApp.ctx
            var rid = c.resources.getIdentifier("wp_$id", "drawable", c.packageName)
            if (rid == 0) rid = c.resources.getIdentifier("wp_fungo", "drawable", c.packageName)
            if (rid == 0) null else BitmapFactory.decodeResource(c.resources, rid)?.asImageBitmap()
        }
    }
}
