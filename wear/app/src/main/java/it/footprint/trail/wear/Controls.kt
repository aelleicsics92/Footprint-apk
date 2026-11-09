package it.footprint.trail.wear

import android.Manifest
import android.content.pm.PackageManager
import android.view.KeyEvent
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.math.roundToInt

class WItem(val key: String, val label: String, val letter: String, val color: Long, val cmd: Boolean = false)
class MI(val id: String, val label: String)

/**
 * Tutti i comandi dell'app, azionabili con corona e tasti fisici (nessun tocco necessario).
 *
 * Tasto SALVA (default tasto basso):
 *   pressione = salva subito il waypoint (modalita' "subito") oppure apre il menu a ruota ("a ruota")
 *   pressione lunga = l'altra modalita'; nel menu a ruota: pressione = conferma, lunga = annulla
 *   su Punti/Menu: pressione = attiva la voce selezionata
 * Tasto ALT (se disponibile): pressione = schermata successiva, lunga = tag vocale
 * Corona: mappa = zoom; Punti/Menu/ruota = selezione; Viaggio/Bussola = cambio schermata
 */
object Controls {
    private val ctx get() = FpApp.ctx
    var suppressUp = 0

    val wheel: List<WItem> = Types.all.map { WItem(it.id, it.label, it.letter, it.color) } + listOf(
        WItem("cmd_next", "Schermata", ">", 0xFF3B9BD1, true),
        WItem("cmd_voice", "Tag vocale", "V", 0xFF8A5BD6, true),
        WItem("cmd_lock", "Blocco touch", "L", 0xFF3B9BD1, true),
        WItem("cmd_cancel", "Annulla", "X", 0xFF555555, true)
    )

    fun toast(msg: String) {
        AppState.toast = msg
        AppState.scope.launch(Dispatchers.Main) {
            delay(2200)
            if (AppState.toast == msg) AppState.toast = null
        }
    }

    fun keyName(code: Int): String = when (code) {
        KeyEvent.KEYCODE_STEM_PRIMARY -> "STEM_P"
        KeyEvent.KEYCODE_STEM_1 -> "STEM_1"
        KeyEvent.KEYCODE_STEM_2 -> "STEM_2"
        KeyEvent.KEYCODE_STEM_3 -> "STEM_3"
        0 -> "-"
        else -> "#$code"
    }

    /** Chiamato da onKeyDown: registra il tasto, gestisce l'assegnazione, dice se il tasto e' nostro. */
    fun keyDown(code: Int): Boolean {
        if (code in KeyEvent.KEYCODE_STEM_PRIMARY..KeyEvent.KEYCODE_STEM_3) AppState.lastKey = code
        if (AppState.learn != 0 && code in KeyEvent.KEYCODE_STEM_1..KeyEvent.KEYCODE_STEM_3) {
            if (AppState.learn == 1) {
                AppState.saveKey = code
                AppState.putInt("saveKey", code)
            } else {
                AppState.altKey = code
                AppState.putInt("altKey", code)
            }
            AppState.learn = 0
            suppressUp = code
            Haptics.tick()
            toast("Tasto assegnato: ${keyName(code)}")
            return true
        }
        return code == AppState.saveKey || code == AppState.altKey
    }

    // ---- Salvataggio waypoint ----

    private fun hhmm(): String = SimpleDateFormat("HH:mm", Locale.ITALY).format(Date())

    fun instantSave(typeId: String) {
        val t = Types.byId(typeId)
        AppState.lastType = typeId
        AppState.putStr("lastType", typeId)
        saveAt(AppState.bestFix(), t.icon, "${t.prefix} ${hhmm()}", t.label, false)
    }

    fun saveAt(f: Fix?, icon: String, title: String, label: String, dog: Boolean) {
        if (f == null) {
            Haptics.error()
            toast("GPS non pronto")
            return
        }
        val w = Waypoint(
            UUID.randomUUID().toString(), icon, title,
            f.lat, f.lon, f.alt, f.acc, System.currentTimeMillis(), dog
        )
        AppState.alerted.add(w.id)
        AppState.waypoints.add(w)
        AppState.scope.launch(Dispatchers.IO) {
            Store.db.upsert(w)
            withContext(Dispatchers.Main) {
                Haptics.saved()
                toast("$label  ±${f.acc.roundToInt()} m")
            }
            Sync.push(ctx, w)
        }
    }

    fun deleteWp(w: Waypoint) {
        AppState.waypoints.removeAll { it.id == w.id }
        if (AppState.targetId == w.id) {
            AppState.targetId = null
            AppState.putStr("target", null)
        }
        AppState.scope.launch(Dispatchers.IO) {
            Store.db.softDelete(w.id, false)
            Sync.push(ctx, w.copy(deleted = true))
        }
        toast("Eliminato: ${w.title}")
    }

    fun voice() {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            toast("Permesso microfono mancante")
            return
        }
        val at = AppState.bestFix()
        Haptics.tick()
        toast("Parla...")
        Voice.listen(ctx) { text ->
            if (text.isNullOrBlank()) {
                Haptics.error()
                toast("Non capito")
                return@listen
            }
            val lastIcon = Types.byId(AppState.lastType).icon
            val tag = Voice.match(text)
            if (tag != null) {
                saveAt(at, tag.icon ?: lastIcon, tag.title, tag.title, tag.dog)
            } else {
                val t = text.trim().replaceFirstChar { it.uppercase() }
                saveAt(at, lastIcon, t, t, false)
            }
        }
    }

    // ---- Menu a ruota ----

    fun openWheel() {
        AppState.wheelIndex = wheel.indexOfFirst { it.key == AppState.lastType }.coerceAtLeast(0)
        AppState.wheelOpen = true
        Haptics.tick()
    }

    fun closeWheel() {
        AppState.wheelOpen = false
    }

    fun wheelConfirm() {
        val it = wheel[AppState.wheelIndex]
        closeWheel()
        if (it.cmd) {
            when (it.key) {
                "cmd_next" -> nextScreen(1)
                "cmd_voice" -> voice()
                "cmd_lock" -> toggleLock()
                else -> {}
            }
        } else {
            instantSave(it.key)
        }
    }

    // ---- Tasti ----

    fun onSavePress() {
        when {
            AppState.wheelOpen -> wheelConfirm()
            AppState.screen == 3 || AppState.screen == 4 -> activateSelection()
            AppState.keyMode == 0 -> instantSave(AppState.lastType)
            else -> openWheel()
        }
    }

    fun onSaveLong() {
        when {
            AppState.wheelOpen -> closeWheel()
            AppState.screen == 3 || AppState.screen == 4 -> openWheel()
            AppState.keyMode == 0 -> openWheel()
            else -> instantSave(AppState.lastType)
        }
    }

    fun onAltPress() {
        if (AppState.wheelOpen) closeWheel() else nextScreen(1)
    }

    fun onAltLong() {
        voice()
    }

    // ---- Corona ----

    fun rotary(steps: Int) {
        if (steps == 0) return
        Haptics.step()
        if (AppState.wheelOpen) {
            val n = wheel.size
            AppState.wheelIndex = ((AppState.wheelIndex + steps) % n + n) % n
            return
        }
        when (AppState.screen) {
            0 -> setZoom(AppState.zoom + steps)
            3 -> {
                val n = AppState.waypoints.size
                AppState.listSel = (AppState.listSel + steps).coerceIn(0, (n - 1).coerceAtLeast(0))
            }
            4 -> {
                val n = menuItems().size
                AppState.menuSel = (AppState.menuSel + steps).coerceIn(0, n - 1)
            }
            else -> nextScreen(if (steps > 0) 1 else -1)
        }
    }

    fun setZoom(z: Int) {
        val lo = if (TileCache.has) TileCache.minZ else 3
        val hi = if (TileCache.has) TileCache.maxZ else 18
        AppState.zoom = z.coerceIn(lo, hi)
        AppState.putInt("zoom", AppState.zoom)
    }

    fun nextScreen(d: Int) {
        AppState.screen = ((AppState.screen + d) % 5 + 5) % 5
        if (AppState.screen == 0) {
            AppState.panX = 0f
            AppState.panY = 0f
        }
    }

    fun toggleLock() {
        AppState.touchLock = !AppState.touchLock
        AppState.putBool("lock", AppState.touchLock)
        Haptics.tick()
        toast(if (AppState.touchLock) "Touch bloccato" else "Touch attivo")
    }

    // ---- Punti e menu ----

    fun sortedWps(): List<Waypoint> {
        val f = AppState.fix
        val l = AppState.waypoints.toList()
        return if (f != null) l.sortedBy { Geo.dist(f.lat, f.lon, it.lat, it.lon) } else l.sortedByDescending { it.ts }
    }

    private fun onOff(b: Boolean) = if (b) "SI" else "NO"

    fun menuItems(): List<MI> = listOf(
        MI("lock", "Blocco touch: ${onOff(AppState.touchLock)}"),
        MI("return", "Rientro: ${onOff(AppState.returnMode)}"),
        MI("car", "Torna all'auto"),
        MI("notarget", "Azzera destinazione"),
        MI("mode", "Tasto salva: " + if (AppState.keyMode == 0) "subito" else "a ruota"),
        MI("theme", "Tema: " + if (AppState.theme == 0) "neon" else "rosso notte"),
        MI("prox", "Vicinanza: ${AppState.proxM} m"),
        MI("rot", "Corona: " + when (AppState.rotaryPx) { 25f -> "sensibile"; 70f -> "lenta"; else -> "media" }),
        MI("tscale", "Mappa: ${AppState.tileScale}x"),
        MI("learnSave", "Assegna SALVA (${keyName(AppState.saveKey)})"),
        MI("learnAlt", "Assegna ALT (${keyName(AppState.altKey)})"),
        MI("endTrip", "Fine uscita > telefono"),
        MI("clearMaps", "Cancella mappe"),
        MI("exit", "Esci e ferma GPS"),
        MI("back", "Torna alla mappa")
    )

    fun activateSelection() {
        if (AppState.screen == 3) {
            val w = sortedWps().getOrNull(AppState.listSel) ?: return
            AppState.targetId = w.id
            AppState.putStr("target", w.id)
            AppState.returnMode = false
            Haptics.tick()
            toast("Destinazione: ${w.title}")
            AppState.screen = 1
        } else if (AppState.screen == 4) {
            runMenu(menuItems().getOrNull(AppState.menuSel)?.id)
        }
    }

    fun runMenu(id: String?) {
        when (id) {
            "lock" -> toggleLock()
            "return" -> {
                if (!AppState.returnMode && AppState.track.size < 3) {
                    toast("Nessuna traccia per il rientro")
                } else {
                    AppState.returnMode = !AppState.returnMode
                    if (AppState.returnMode) {
                        AppState.screen = 0
                        toast("Rientro attivo")
                    } else {
                        AppState.returnNext = null
                        toast("Rientro spento")
                    }
                }
            }
            "car" -> {
                val car = AppState.waypoints.filter { it.icon == "parcheggio" }.maxByOrNull { it.ts }
                if (car == null) {
                    toast("Nessuna auto salvata")
                } else {
                    AppState.targetId = car.id
                    AppState.putStr("target", car.id)
                    AppState.returnMode = false
                    AppState.screen = 1
                    toast("Verso l'auto")
                }
            }
            "notarget" -> {
                AppState.targetId = null
                AppState.putStr("target", null)
                AppState.returnMode = false
                AppState.returnNext = null
                toast("Destinazione azzerata")
            }
            "mode" -> {
                AppState.keyMode = 1 - AppState.keyMode
                AppState.putInt("keyMode", AppState.keyMode)
            }
            "theme" -> {
                AppState.theme = 1 - AppState.theme
                AppState.putInt("theme", AppState.theme)
            }
            "prox" -> {
                val v = listOf(10, 15, 25, 40)
                AppState.proxM = v[(v.indexOf(AppState.proxM) + 1) % v.size]
                AppState.putInt("proxM", AppState.proxM)
            }
            "rot" -> {
                val v = listOf(25f, 40f, 70f)
                AppState.rotaryPx = v[(v.indexOf(AppState.rotaryPx) + 1) % v.size]
                AppState.putFloat("rot", AppState.rotaryPx)
            }
            "tscale" -> {
                val v = listOf(1f, 1.5f, 2f)
                AppState.tileScale = v[(v.indexOf(AppState.tileScale) + 1) % v.size]
                AppState.putFloat("tscale", AppState.tileScale)
            }
            "learnSave" -> {
                AppState.learn = 1
                toast("Premi il tasto per SALVARE")
            }
            "learnAlt" -> {
                AppState.learn = 2
                toast("Premi il tasto ALT")
            }
            "endTrip" -> endTrip()
            "clearMaps" -> {
                TileCache.clear()
                toast("Mappe cancellate")
            }
            "exit" -> AppState.exitRequested = true
            "back" -> AppState.screen = 0
        }
    }

    private fun endTrip() {
        val now = System.currentTimeMillis()
        val start = if (AppState.startTs > 0) AppState.startTs else now
        val d = AppState.distance
        val up = AppState.ascent
        val down = AppState.descent
        val mx = AppState.maxSpeed
        AppState.scope.launch(Dispatchers.IO) {
            val pts = Store.db.loadTrack()
            Sync.pushTrip(ctx, start, d, up, down, mx, pts)
            Store.db.clearTrack()
            withContext(Dispatchers.Main) {
                AppState.track.clear()
                AppState.returnMode = false
                AppState.returnNext = null
                AppState.distance = 0.0
                AppState.ascent = 0.0
                AppState.descent = 0.0
                AppState.maxSpeed = 0f
                AppState.startTs = System.currentTimeMillis()
                toast("Uscita inviata al telefono")
            }
        }
    }
}
