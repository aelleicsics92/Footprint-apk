package it.footprint.trail.wear

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.PowerManager
import kotlin.math.abs
import kotlin.math.sqrt

/** Riaccende lo schermo quando alzi il polso (attivo solo in ambient). */
class WristWake(private val ctx: Context, private val onWake: () -> Unit) : SensorEventListener {
    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private var on = false
    private var lastMag = 9.8f
    private var lastWake = 0L
    private var still = 0L

    fun start() {
        if (on) return
        val s = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        on = sm.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL)
        still = System.currentTimeMillis()
    }

    fun stop() {
        if (!on) return
        sm.unregisterListener(this)
        on = false
    }

    @Suppress("DEPRECATION")
    fun wakeScreen() {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "fp:wrist").acquire(6000L)
    }

    override fun onSensorChanged(e: SensorEvent) {
        val now = System.currentTimeMillis()
        val mag = sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2])
        val moved = abs(mag - lastMag) > 3.5f
        lastMag = mag
        // schermo rivolto verso l'alto/viso dopo un movimento brusco
        if (moved && e.values[2] > 4f && now - lastWake > 3000) {
            lastWake = now
            wakeScreen()
            onWake()
        }
    }

    override fun onAccuracyChanged(s: Sensor?, a: Int) {}
}
