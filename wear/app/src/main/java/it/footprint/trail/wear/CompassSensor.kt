package it.footprint.trail.wear

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.abs

/** Bussola da vettore di rotazione, nord vero (declinazione) e filtro anti tremolio. */
class CompassSensor(ctx: Context) : SensorEventListener {
    companion object {
        private var raw = Float.NaN
        private var bias = 0f

        private fun diff(a: Float, b: Float): Float = ((a - b + 540f) % 360f) - 180f

        /** Allinea la bussola alla direzione reale di cammino (GPS): corregge sensore non calibrato e offset fissi. */
        fun feedGps(course: Float, speed: Float) {
            if (raw.isNaN() || speed < 1.3f) return
            val d = diff(course, raw)
            if (Math.abs(d) > 35f + Math.abs(bias)) return
            bias = (bias + (d - bias) * 0.08f).coerceIn(-25f, 25f)
        }

        fun resetBias() { bias = 0f }
    }

    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val rv: Sensor? = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val rot = FloatArray(9)
    private val ori = FloatArray(3)
    private var smooth = Float.NaN
    private var running = false

    /** In ambient i campioni vengono raggruppati (batching) per risparmiare batteria. */
    fun start(ambient: Boolean) {
        stop()
        val s = rv ?: return
        if (ambient) {
            sm.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL, 20_000_000)
        } else {
            sm.registerListener(this, s, SensorManager.SENSOR_DELAY_UI)
        }
        running = true
    }

    fun stop() {
        if (running) sm.unregisterListener(this)
        running = false
    }

    override fun onSensorChanged(e: SensorEvent) {
        SensorManager.getRotationMatrixFromVector(rot, e.values)
        // Cima dell'orologio (12) se e' quasi in piano, retro della cassa se e' in verticale: come sul telefono
        val topE = rot[1]; val topN = rot[4]
        val backE = -rot[2]; val backN = -rot[5]
        val useTop = Math.hypot(topE.toDouble(), topN.toDouble()) >= Math.hypot(backE.toDouble(), backN.toDouble())
        val e1 = if (useTop) topE else backE
        val n1 = if (useTop) topN else backN
        var az = Math.toDegrees(Math.atan2(e1.toDouble(), n1.toDouble())).toFloat() + AppState.declination
        az = (az + 360f) % 360f
        AppState.compassAcc = e.accuracy
        smooth = if (smooth.isNaN()) {
            az
        } else {
            var d = az - smooth
            if (d > 180f) d -= 360f
            if (d < -180f) d += 360f
            (smooth + d * 0.25f + 360f) % 360f
        }
        raw = smooth
        val shown = (smooth + bias + 360f) % 360f
        val cur = AppState.heading
        var diff = shown - cur
        if (diff > 180f) diff -= 360f
        if (diff < -180f) diff += 360f
        if (abs(diff) >= 1f) AppState.heading = shown
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
