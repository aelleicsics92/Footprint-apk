package it.footprint.trail.wear

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.abs

/** Bussola da vettore di rotazione, nord vero (declinazione) e filtro anti tremolio. */
class CompassSensor(ctx: Context) : SensorEventListener {
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
        SensorManager.getOrientation(rot, ori)
        var az = Math.toDegrees(ori[0].toDouble()).toFloat() + AppState.declination
        az = (az + 360f) % 360f
        smooth = if (smooth.isNaN()) {
            az
        } else {
            var d = az - smooth
            if (d > 180f) d -= 360f
            if (d < -180f) d += 360f
            (smooth + d * 0.25f + 360f) % 360f
        }
        val cur = AppState.heading
        var diff = smooth - cur
        if (diff > 180f) diff -= 360f
        if (diff < -180f) diff += 360f
        if (abs(diff) >= 1f) AppState.heading = smooth
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
