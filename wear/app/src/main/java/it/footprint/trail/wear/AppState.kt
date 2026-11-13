package it.footprint.trail.wear

import android.content.Context
import android.content.SharedPreferences
import android.view.KeyEvent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.util.Collections

class Pal(val bg: Color, val main: Color, val sec: Color, val text: Color, val dim: Color) {
    companion object {
        // 0 = ultra contrasto (nero OLED, giallo/verde neon), 1 = rosso notte
        private val HC = Pal(Color.Black, Color(0xFFE6FF00), Color(0xFF39FF14), Color.White, Color(0xFF9A9A9A))
        private val RED = Pal(Color.Black, Color(0xFFD01010), Color(0xFF8A0A0A), Color(0xFFE03030), Color(0xFF6A0808))
        fun of(theme: Int): Pal = if (theme == 1) RED else HC
    }
}

object AppState {
    lateinit var sp: SharedPreferences
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // Posizione e sensori
    var fix by mutableStateOf<Fix?>(null)
    var heading by mutableFloatStateOf(0f)
    var shownHeading by mutableFloatStateOf(0f)
    var declination = 0f
    var still by mutableStateOf(false)
    val recent: MutableList<Fix> = Collections.synchronizedList(ArrayList<Fix>())

    // Dati
    val waypoints = mutableStateListOf<Waypoint>()
    val track = mutableStateListOf<LL>()
    var returnNext by mutableStateOf<LL?>(null)
    val alerted: MutableSet<String> = Collections.synchronizedSet(HashSet<String>())

    // Statistiche uscita
    var startTs by mutableStateOf(0L)
    var distance by mutableDoubleStateOf(0.0)
    var ascent by mutableDoubleStateOf(0.0)
    var descent by mutableDoubleStateOf(0.0)
    var maxSpeed by mutableFloatStateOf(0f)

    // Interfaccia
    var screen by mutableIntStateOf(0) // 0 mappa, 1 viaggio, 2 bussola, 3 punti, 4 menu
    var ambient by mutableStateOf(false)
    var toast by mutableStateOf<String?>(null)
    var wheelOpen by mutableStateOf(false)
    var wheelIndex by mutableIntStateOf(0)
    var listSel by mutableIntStateOf(0)
    var menuSel by mutableIntStateOf(0)
    var panX by mutableFloatStateOf(0f)
    var panY by mutableFloatStateOf(0f)
    var lastKey by mutableIntStateOf(0)
    var learn by mutableIntStateOf(0) // 0 no, 1 tasto SALVA, 2 tasto ALT
    var listening by mutableStateOf(false)
    var exitRequested by mutableStateOf(false)

    // Preferenze salvate
    var touchLock by mutableStateOf(false)
    var returnMode by mutableStateOf(false)
    var keyMode by mutableIntStateOf(0) // 0 salva subito, 1 menu a ruota
    var theme by mutableIntStateOf(0)
    var proxM by mutableIntStateOf(15)
    var rotaryPx by mutableFloatStateOf(40f)
    var tileScale by mutableFloatStateOf(1.5f)
    var zoom by mutableIntStateOf(16)
    var saveKey by mutableIntStateOf(KeyEvent.KEYCODE_STEM_2)
    var altKey by mutableIntStateOf(KeyEvent.KEYCODE_STEM_1)
    var lastType by mutableStateOf("porcino")
    val icons = mutableStateListOf<String>()
    var offM by mutableIntStateOf(30)
    var rec by mutableStateOf(true)
    var compassAcc by mutableIntStateOf(3)
    var mapSrc by mutableStateOf("sat") // strato mostrato dalla mappa: sat o topo
    var menuGroup by mutableIntStateOf(-1)
    var iconScale by mutableFloatStateOf(1f)
    var haptic by mutableIntStateOf(2)
    var wristWake by mutableStateOf(true)
    var confirmId: String? = null
    var confirmTs = 0L
    var recConfirm = 0L
    var crumbReset = false
    var showSaved by mutableStateOf(true)
    val saved = mutableStateListOf<List<LL>>()
    var targetId by mutableStateOf<String?>(null)

    fun load(c: Context) {
        sp = c.getSharedPreferences("fp", Context.MODE_PRIVATE)
        touchLock = sp.getBoolean("lock", false)
        keyMode = sp.getInt("keyMode", 0)
        theme = sp.getInt("theme", 0)
        proxM = sp.getInt("proxM", 15)
        rotaryPx = sp.getFloat("rot", 40f)
        tileScale = sp.getFloat("tscale", 1.5f)
        zoom = sp.getInt("zoom", 16)
        saveKey = sp.getInt("saveKey", KeyEvent.KEYCODE_STEM_2)
        altKey = sp.getInt("altKey", KeyEvent.KEYCODE_STEM_1)
        offM = sp.getInt("offM", 30)
        rec = sp.getBoolean("rec", true)
        iconScale = sp.getFloat("iconScale", 1f)
        mapSrc = sp.getString("mapSrc", "sat") ?: "sat"
        haptic = sp.getInt("haptic", 2)
        wristWake = sp.getBoolean("wristWake", true)
        showSaved = sp.getBoolean("showSaved", true)
        icons.clear()
        icons.addAll((sp.getString("icons", null) ?: "").split(",").filter { it.isNotBlank() }.ifEmpty { Labels.defaults })
        lastType = sp.getString("lastType", null) ?: icons.first()
        targetId = sp.getString("target", null)
    }

    fun putInt(k: String, v: Int) = sp.edit().putInt(k, v).apply()
    fun putBool(k: String, v: Boolean) = sp.edit().putBoolean(k, v).apply()
    fun putFloat(k: String, v: Float) = sp.edit().putFloat(k, v).apply()
    fun putStr(k: String, v: String?) = sp.edit().putString(k, v).apply()

    /** Centro mappa: posizione attuale, altrimenti ultimo waypoint, altrimenti Italia centrale. */
    fun center(): LL {
        val f = fix
        if (f != null) return LL(f.lat, f.lon)
        val w = waypoints.lastOrNull()
        if (w != null) return LL(w.lat, w.lon)
        return LL(41.9028, 12.4964)
    }

    fun targetWp(): Waypoint? = targetId?.let { id -> waypoints.firstOrNull { it.id == id } }

    /** Destinazione attiva: punto di rientro lungo la traccia, oppure waypoint scelto. */
    fun navTarget(): NavTarget? {
        if (returnMode) {
            val r = returnNext
            if (r != null) return NavTarget(r.lat, r.lon, "Rientro")
        }
        val w = targetWp() ?: return null
        return NavTarget(w.lat, w.lon, w.title)
    }

    fun recentAdd(f: Fix) {
        synchronized(recent) {
            recent.add(f)
            val limit = f.ts - 15000
            recent.removeAll { it.ts < limit }
        }
    }

    /**
     * Posizione migliore per un waypoint: da fermo media pesata dei fix recenti (peso 1/acc^2),
     * in movimento ultimo fix proiettato in avanti del ritardo (velocita x eta').
     */
    fun bestFix(): Fix? {
        val last = fix ?: return null
        val now = System.currentTimeMillis()
        if (still) {
            val cand = synchronized(recent) { recent.filter { now - it.ts < 12000 && it.acc <= 25f } }
            if (cand.size >= 2) {
                var sw = 0.0
                var la = 0.0
                var lo = 0.0
                var al = 0.0
                for (f in cand) {
                    val w = 1.0 / (f.acc * f.acc).coerceAtLeast(1f).toDouble()
                    sw += w
                    la += f.lat * w
                    lo += f.lon * w
                    al += f.alt * w
                }
                return Fix(la / sw, lo / sw, al / sw, cand.minOf { it.acc }, 0f, last.bearing, now)
            }
            return last
        }
        val ageS = ((now - last.ts) / 1000.0).coerceIn(0.0, 3.0)
        if (last.speed > 0.8f && ageS > 0.3) {
            val p = Geo.project(last.lat, last.lon, last.bearing.toDouble(), last.speed * ageS)
            return last.copy(lat = p.lat, lon = p.lon)
        }
        return last
    }
}
