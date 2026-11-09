package it.footprint.trail.wear

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * Servizio in primo piano: GPS, breadcrumb, prossimita' waypoint, fuori traccia.
 * Campionamento adattivo: veloce in movimento, lento quando l'accelerometro dice che e' fermo.
 */
class TrackingService : Service(), SensorEventListener {
    companion object {
        const val CH = "fp_tracking"
        const val NOTIF_ID = 77
    }

    private lateinit var fused: FusedLocationProviderClient
    private lateinit var sm: SensorManager
    private var curInterval = 0L
    private var lastCrumb: Fix? = null
    private var altRef = Double.NaN
    private var lastOff = 0L
    private var lastMove = System.currentTimeMillis()
    private var stillSince = 0L
    private var accEma = 0f
    private var lastDecl = 0L

    private val cb = object : LocationCallback() {
        override fun onLocationResult(r: LocationResult) {
            for (l in r.locations) onLoc(l)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

    override fun onCreate() {
        super.onCreate()
        startFg()
        fused = LocationServices.getFusedLocationProviderClient(this)
        sm = getSystemService(SENSOR_SERVICE) as SensorManager
        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL, 2_000_000)
        }
        if (AppState.startTs == 0L) AppState.startTs = System.currentTimeMillis()
        request(2000L)
    }

    private fun startFg() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW)
        )
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val nb = NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Footprint")
            .setContentText(getString(R.string.notif_text))
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setContentIntent(pi)
        OngoingActivity.Builder(this, NOTIF_ID, nb)
            .setStaticIcon(R.drawable.ic_stat)
            .setTouchIntent(pi)
            .build()
            .apply(this)
        ServiceCompat.startForeground(this, NOTIF_ID, nb.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    }

    @SuppressLint("MissingPermission")
    private fun request(intervalMs: Long) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }
        curInterval = intervalMs
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs / 2)
            .setMinUpdateDistanceMeters(0f)
            .build()
        fused.requestLocationUpdates(req, cb, Looper.getMainLooper())
    }

    /** Frequenza GPS: fermo = 15 s (30 s dopo 2 minuti), ambient = 5 s, altrimenti 2 s. */
    private fun adaptRate() {
        val now = System.currentTimeMillis()
        val isStill = now - lastMove > 20_000
        if (isStill != AppState.still) {
            AppState.still = isStill
            stillSince = if (isStill) now else 0L
        }
        val want = when {
            isStill -> if (now - stillSince > 120_000) 30_000L else 15_000L
            AppState.ambient -> 5_000L
            else -> 2_000L
        }
        if (want != curInterval) request(want)
    }

    override fun onSensorChanged(e: SensorEvent) {
        val mag = Math.sqrt((e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]).toDouble()).toFloat()
        val dev = abs(mag - 9.81f)
        accEma = accEma * 0.9f + dev * 0.1f
        if (accEma > 0.35f) lastMove = System.currentTimeMillis()
        adaptRate()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun onLoc(l: Location) {
        val now = System.currentTimeMillis()
        val f = Fix(
            l.latitude, l.longitude,
            if (l.hasAltitude()) l.altitude else 0.0,
            if (l.hasAccuracy()) l.accuracy else 99f,
            if (l.hasSpeed()) l.speed else 0f,
            if (l.hasBearing()) l.bearing else 0f,
            now
        )
        AppState.fix = f
        AppState.recentAdd(f)

        if (now - lastDecl > 600_000) {
            lastDecl = now
            AppState.declination = GeomagneticField(
                f.lat.toFloat(), f.lon.toFloat(), f.alt.toFloat(), now
            ).declination
        }

        if (!AppState.still && f.acc <= 30f) crumb(f)
        if (f.speed > AppState.maxSpeed && !AppState.still) AppState.maxSpeed = f.speed

        checkProximity(f)
        if (AppState.returnMode) updateReturn(f, now)
        adaptRate()
    }

    /** Breadcrumb ogni 5 m: traccia per il rientro, distanza, dislivello (auto-pause quando fermo). */
    private fun crumb(f: Fix) {
        val last = lastCrumb
        if (last != null && Geo.dist(last.lat, last.lon, f.lat, f.lon) < 5.0) return
        if (last != null) AppState.distance += Geo.dist(last.lat, last.lon, f.lat, f.lon)
        lastCrumb = f
        if (altRef.isNaN()) altRef = f.alt
        if (abs(f.alt - altRef) >= 4.0) {
            if (f.alt > altRef) AppState.ascent += f.alt - altRef else AppState.descent += altRef - f.alt
            altRef = f.alt
        }
        val pt = LL(f.lat, f.lon)
        AppState.scope.launch(Dispatchers.Main) {
            AppState.track.add(pt)
            if (AppState.track.size > 4000) {
                val keep = AppState.track.filterIndexed { i, _ -> i % 2 == 0 }
                AppState.track.clear()
                AppState.track.addAll(keep)
            }
        }
        AppState.scope.launch(Dispatchers.IO) { Store.db.addTrack(TrackPt(f.lat, f.lon, f.alt, f.ts)) }
    }

    private fun checkProximity(f: Fix) {
        val thr = AppState.proxM.toDouble()
        for (w in AppState.waypoints.toList()) {
            val d = Geo.dist(f.lat, f.lon, w.lat, w.lon)
            if (d < thr) {
                if (AppState.alerted.add(w.id)) {
                    Haptics.proximityStart()
                    AppState.scope.launch(Dispatchers.Main) { Controls.toast("Vicino: ${w.title}") }
                }
            } else if (d > thr * 2.5) {
                AppState.alerted.remove(w.id)
            }
        }
    }

    /** Prossimo punto del rientro (verso l'inizio, almeno 25 m avanti) e allarme fuori traccia. */
    private fun updateReturn(f: Fix, now: Long) {
        val t = AppState.track.toList()
        if (t.size < 2) {
            AppState.returnNext = null
            return
        }
        var bi = 0
        var bd = Double.MAX_VALUE
        for (i in t.indices) {
            val d = Geo.dist(f.lat, f.lon, t[i].lat, t[i].lon)
            if (d < bd) {
                bd = d
                bi = i
            }
        }
        var j = bi
        while (j > 0 && Geo.dist(f.lat, f.lon, t[j].lat, t[j].lon) < 25.0) j--
        AppState.returnNext = t[j]
        if (j == 0 && Geo.dist(f.lat, f.lon, t[0].lat, t[0].lon) < 15.0) {
            AppState.returnMode = false
            AppState.returnNext = null
            AppState.scope.launch(Dispatchers.Main) { Controls.toast("Rientro completato") }
            return
        }
        if (bd > 30.0 && now - lastOff > 45_000) {
            lastOff = now
            Haptics.offTrack()
            AppState.scope.launch(Dispatchers.Main) { Controls.toast("Fuori traccia: ${bd.toInt()} m") }
        }
    }

    override fun onDestroy() {
        fused.removeLocationUpdates(cb)
        sm.unregisterListener(this)
        Haptics.cancel()
        super.onDestroy()
    }
}
