package it.footprint.trail.wear

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Pattern aptici distinguibili senza guardare lo schermo:
 *  - tick: pressione tasto registrata
 *  - saved: waypoint salvato (doppio impulso)
 *  - proximity: vicino a un waypoint (pulsazione continua)
 *  - offTrack: fuori traccia (3 impulsi lunghi)
 */
object Haptics {
    private var proxJob: Job? = null

    @Suppress("DEPRECATION")
    private fun vib(): Vibrator {
        val c = FpApp.ctx
        return if (Build.VERSION.SDK_INT >= 31) {
            c.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            c.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }

    private fun wave(t: LongArray, amp0: IntArray, repeat: Int = -1) {
        val v = vib()
        if (!v.hasVibrator()) return
        val lv = AppState.haptic
        if (lv <= 0) return
        val k = when (lv) { 1 -> 0.45f; 3 -> 1.4f; else -> 1f }
        val amp = IntArray(amp0.size) { i -> if (amp0[i] == 0) 0 else (amp0[i] * k).toInt().coerceIn(20, 255) }
        val e = if (v.hasAmplitudeControl()) {
            VibrationEffect.createWaveform(t, amp, repeat)
        } else {
            VibrationEffect.createWaveform(t, repeat)
        }
        v.vibrate(e)
    }

    fun step() = wave(longArrayOf(0, 8), intArrayOf(0, 120))

    fun tick() = wave(longArrayOf(0, 25), intArrayOf(0, 180))

    fun saved() = wave(longArrayOf(0, 80, 90, 80), intArrayOf(0, 255, 0, 255))

    fun error() = wave(longArrayOf(0, 450), intArrayOf(0, 255))

    fun offTrack() = wave(longArrayOf(0, 700, 250, 700, 250, 700), intArrayOf(0, 255, 0, 255, 0, 255))

    fun proximityStart(maxMs: Long = 8000) {
        proxJob?.cancel()
        wave(longArrayOf(0, 350, 250), intArrayOf(0, 255, 0), 1)
        proxJob = AppState.scope.launch {
            delay(maxMs)
            vib().cancel()
        }
    }

    fun cancel() {
        proxJob?.cancel()
        vib().cancel()
    }
}
