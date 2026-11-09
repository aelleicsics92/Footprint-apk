package it.footprint.trail.wear

import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class FpApp : Application() {
    companion object {
        lateinit var ctx: Application
    }

    override fun onCreate() {
        super.onCreate()
        ctx = this
        AppState.load(this)
        Store.init(this)
        TileCache.init(this)
        AppState.scope.launch {
            val wps = Store.db.allWp()
            val tr = Store.db.loadTrack()
            withContext(Dispatchers.Main) {
                AppState.waypoints.clear()
                AppState.waypoints.addAll(wps)
                AppState.track.clear()
                AppState.track.addAll(tr.map { LL(it.lat, it.lon) })
            }
            Sync.pushAllUnsynced(this@FpApp)
        }
    }
}
