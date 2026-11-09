package it.footprint.trail.wear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.wear.ambient.AmbientLifecycleObserver

class MainActivity : ComponentActivity() {

    private val compass by lazy { CompassSensor(this) }
    private lateinit var ambientObserver: AmbientLifecycleObserver

    private val ambientCallback = object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            AppState.ambient = true
            AppState.shownHeading = AppState.heading
            compass.start(true)
        }

        override fun onExitAmbient() {
            AppState.ambient = false
            compass.start(false)
        }

        override fun onUpdateAmbient() {
            AppState.shownHeading = AppState.heading
        }
    }

    private val permLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { startTracking() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ambientObserver = AmbientLifecycleObserver(this, ambientCallback)
        lifecycle.addObserver(ambientObserver)
        setContent { FpRoot() }
        requestPerms()
    }

    override fun onStart() {
        super.onStart()
        compass.start(AppState.ambient)
        startTracking()
    }

    override fun onStop() {
        compass.stop()
        super.onStop()
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun requestPerms() {
        val need = ArrayList<String>()
        need.add(Manifest.permission.ACCESS_FINE_LOCATION)
        need.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        need.add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) need.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = need.filter { !granted(it) }
        if (missing.isEmpty()) startTracking() else permLauncher.launch(missing.toTypedArray())
    }

    private fun startTracking() {
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java))
        }
    }

    // ---- Tasti fisici ----

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (Controls.keyDown(keyCode)) {
            if (event.repeatCount == 0) event.startTracking()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == Controls.suppressUp) return true
        if (keyCode == AppState.saveKey) {
            Controls.onSaveLong()
            return true
        }
        if (keyCode == AppState.altKey) {
            Controls.onAltLong()
            return true
        }
        return super.onKeyLongPress(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == Controls.suppressUp) {
            Controls.suppressUp = 0
            return true
        }
        if (event.isTracking && !event.isCanceled) {
            if (keyCode == AppState.saveKey) {
                Controls.onSavePress()
                return true
            }
            if (keyCode == AppState.altKey) {
                Controls.onAltPress()
                return true
            }
        }
        return super.onKeyUp(keyCode, event)
    }
}
