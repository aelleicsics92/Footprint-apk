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
class MI(val id: String, val label: String, val value: String = "")

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

    /** Voci del menu a ruota: le 10 icone scelte dal telefono + i comandi. */
    fun wheel(): List<WItem> = AppState.icons.map { WItem(it, Labels.of(it), "", 0xFF000000) } + listOf(
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

    fun instantSave(icon: String) {
        AppState.lastType = icon
        AppState.putStr("lastType", icon)
        val label = Labels.of(icon)
        val title = if (icon == "parcheggio") "Auto parcheggiata" else "$label ${hhmm()}"
        saveAt(AppState.bestFix(), icon, title, label, false)
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
            val lastIcon = AppState.lastType
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
        AppState.wheelIndex = wheel().indexOfFirst { it.key == AppState.lastType }.coerceAtLeast(0)
        AppState.wheelOpen = true
        Haptics.tick()
    }

    fun closeWheel() {
        AppState.wheelOpen = false
    }

    fun wheelConfirm() {
        val it = wheel()[AppState.wheelIndex]
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

    private var tripJob: kotlinx.coroutines.Job? = null
    private var tripPressTs = 0L

    /** Computer di viaggio: doppio clic = avvia/ferma traccia, clic singolo = salva waypoint (dopo 0,35 s). */
    private fun tripPress() {
        val now = System.currentTimeMillis()
        val j = tripJob
        if (j != null && j.isActive && now - tripPressTs < 350) {
            j.cancel()
            tripJob = null
            if (AppState.rec) endTrip() else startRec()
            return
        }
        tripPressTs = now
        tripJob = AppState.scope.launch {
            delay(350)
            withContext(Dispatchers.Main) {
                if (AppState.keyMode == 0) instantSave(AppState.lastType) else openWheel()
            }
        }
    }

    fun onSavePress() {
        when {
            AppState.wheelOpen -> wheelConfirm()
            AppState.screen == 1 -> tripPress()
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

    /** Tasto 1: clic = schermata successiva (o conferma nel menu a ruota), tenuto premuto = nuovo waypoint (icona con la corona). */
    fun onAltPress() {
        when {
            AppState.wheelOpen -> wheelConfirm()
            AppState.screen == 4 -> activateSelection() // nelle impostazioni: tasto 1 = seleziona la voce (corona = scorri)
            else -> nextScreen(1)
        }
    }

    fun onAltLong() {
        when {
            AppState.wheelOpen -> closeWheel()
            AppState.screen == 4 -> { // nelle impostazioni: tenuto premuto = indietro
                Haptics.tick()
                if (AppState.menuGroup >= 0) runMenu("back") else nextScreen(1)
            }
            else -> openWheel()
        }
    }

    /** Conferma a doppia pressione per le azioni distruttive. */
    fun confirmed(id: String, msg: String): Boolean {
        val now = System.currentTimeMillis()
        if (AppState.confirmId == id && now < AppState.confirmTs) {
            AppState.confirmId = null
            return true
        }
        AppState.confirmId = id
        AppState.confirmTs = now + 4000
        toast(msg)
        return false
    }

    // ---- Corona ----

    fun rotary(steps: Int) {
        if (steps == 0) return
        Haptics.step()
        if (AppState.wheelOpen) {
            val n = wheel().size
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
        val hi = if (TileCache.has) (TileCache.maxZ + 3).coerceAtMost(17).coerceAtLeast(TileCache.maxZ) else 17
        AppState.zoom = z.coerceIn(lo, hi)
        AppState.putInt("zoom", AppState.zoom)
    }

    fun nextScreen(d: Int) {
        AppState.menuGroup = -1
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

    private val GROUPS = listOf("Traccia", "Navigazione", "Tasti e corona", "Aspetto", "Sistema")

    private fun tileSize(): String {
        val b = Status.tilesBytes()
        return if (b <= 0) "vuoto" else "%.0f MB".format(b / 1048576.0)
    }

    /** Impostazioni a gruppi: prima l'elenco dei gruppi, poi le voci con il valore attuale. */
    fun menuItems(): List<MI> {
        val g = AppState.menuGroup
        if (g < 0) {
            return listOf(
                MI("g0", "Traccia", if (AppState.rec) "in registrazione" else "ferma"),
                MI("g1", "Navigazione", AppState.navTarget()?.name ?: "nessuna destinazione"),
                MI("g2", "Tasti e corona", if (AppState.keyMode == 0) "salva subito" else "salva a ruota"),
                MI("g3", "Aspetto", if (AppState.theme == 0) "tema neon" else "tema rosso notte"),
                MI("g4", "Sistema", "mappe, GPS, esci"),
                MI("close", "Chiudi menu", "torna alla mappa")
            )
        }
        val back = MI("back", "‹ Indietro", GROUPS[g])
        val list = when (g) {
            0 -> listOf(
                MI("rec", if (AppState.rec) "Ferma e invia al telefono" else "Avvia traccia", if (AppState.rec) "premi 2 volte" else "parte subito"),
                MI("showSaved", "Tracce salvate sulla mappa", onOff(AppState.showSaved)),
                MI("return", "Rientro sui tuoi passi", onOff(AppState.returnMode)),
                MI("offM", "Avviso fuori traccia", "oltre ${AppState.offM} m")
            )
            1 -> listOf(
                MI("car", "Torna all'auto", "imposta destinazione"),
                MI("notarget", "Azzera destinazione", AppState.navTarget()?.name ?: "nessuna"),
                MI("prox", "Vibra vicino al punto", "entro ${AppState.proxM} m")
            )
            2 -> listOf(
                MI("mode", "Tasto salva", if (AppState.keyMode == 0) "salva subito" else "apre il menu a ruota"),
                MI("rot", "Sensibilità corona", when (AppState.rotaryPx) { 25f -> "alta"; 70f -> "bassa"; else -> "media" }),
                MI("lock", "Blocco touch", onOff(AppState.touchLock)),
                MI("learnSave", "Assegna tasto SALVA", keyName(AppState.saveKey)),
                MI("learnAlt", "Assegna tasto 1", keyName(AppState.altKey))
            )
            3 -> listOf(
                MI("mapSrc", "Mappa", (if (AppState.mapSrc == "sat") "Satellite" else "Topografica") + if (AppState.mapSrc in TileCache.srcs) "" else " (non inviata)"),
                MI("theme", "Tema", if (AppState.theme == 0) "neon" else "rosso notte"),
                MI("tscale", "Dettaglio mappa", "${AppState.tileScale}x"),
                MI("iconScale", "Dimensione icone", when (AppState.iconScale) { 0.7f -> "piccole"; 1.35f -> "grandi"; else -> "medie" }),
                MI("haptic", "Vibrazione", when (AppState.haptic) { 0 -> "spenta"; 1 -> "debole"; 3 -> "forte"; else -> "normale" })
            )
            else -> listOf(
                MI("clearMaps", "Cancella mappe", tileSize()),
                MI("compassReset", "Bussola: azzera correzione", "ricalibra col cammino"),
                MI("exit", "Esci e ferma GPS", "premi 2 volte")
            )
        }
        return listOf(back) + list
    }

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
        if (id != null && id.length == 2 && id[0] == 'g') {
            AppState.menuGroup = id[1] - '0'
            AppState.menuSel = 0
            Haptics.tick()
            return
        }
        when (id) {
            "close" -> { AppState.menuGroup = -1; AppState.screen = 0 }
            "offM" -> {
                val v = listOf(15, 30, 50, 100)
                AppState.offM = v[(v.indexOf(AppState.offM) + 1) % v.size]
                AppState.putInt("offM", AppState.offM)
            }
            "mapSrc" -> {
                AppState.mapSrc = if (AppState.mapSrc == "sat") "topo" else "sat"
                AppState.putStr("mapSrc", AppState.mapSrc)
                TileCache.scan()
                toast(if (AppState.mapSrc in TileCache.srcs) "Mappa: " + (if (AppState.mapSrc == "sat") "satellite" else "topografica") else "Nessuna mappa di questo tipo sul watch: inviala dal telefono")
            }
            "iconScale" -> {
                val v = listOf(0.7f, 1f, 1.35f)
                AppState.iconScale = v[(v.indexOf(AppState.iconScale) + 1) % v.size]
                AppState.putFloat("iconScale", AppState.iconScale)
            }
            "haptic" -> {
                AppState.haptic = (AppState.haptic + 1) % 4
                AppState.putInt("haptic", AppState.haptic)
                Haptics.tick()
            }
            "compassReset" -> {
                CompassSensor.resetBias()
                toast("Cammina dritto: la bussola si riallinea al GPS")
            }
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
            "rec" -> recTap()
            "showSaved" -> {
                AppState.showSaved = !AppState.showSaved
                AppState.putBool("showSaved", AppState.showSaved)
            }
            "clearMaps" -> {
                if (!confirmed("clearMaps", "Premi ancora per cancellare le mappe")) return
                TileCache.clear()
                Status.clearMaps()
                AppState.scope.launch { Status.push(ctx) }
                toast("Mappe cancellate")
            }
            "exit" -> if (confirmed("exit", "Premi ancora per uscire")) AppState.exitRequested = true
            "back" -> {
                AppState.menuSel = (AppState.menuGroup).coerceAtLeast(0)
                AppState.menuGroup = -1
            }
        }
    }

    /** Tocco sul pulsante del computer di viaggio: avvia, oppure (con conferma) termina e invia. */
    fun recTap() {
        if (!AppState.rec) {
            startRec()
        } else {
            val now = System.currentTimeMillis()
            if (now < AppState.recConfirm) {
                AppState.recConfirm = 0
                endTrip()
            } else {
                AppState.recConfirm = now + 3000
                toast("Tocca ancora per terminare")
            }
        }
    }

    fun startRec() {
        AppState.scope.launch(Dispatchers.IO) {
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
                AppState.crumbReset = true
                AppState.rec = true
                AppState.putBool("rec", true)
                Haptics.tick()
                toast("Traccia avviata")
            }
            Sync.pushLive(ctx, true)
        }
    }

    fun endTrip() {
        val now = System.currentTimeMillis()
        val start = if (AppState.startTs > 0) AppState.startTs else now
        val d = AppState.distance
        val up = AppState.ascent
        val down = AppState.descent
        val mx = AppState.maxSpeed
        AppState.scope.launch(Dispatchers.IO) {
            val pts = Store.db.loadTrack()
            val ok = pts.size > 1
            if (ok) Sync.pushTrip(ctx, start, d, up, down, mx, pts)
            Store.db.clearTrack()
            Sync.pushLive(ctx, false)
            withContext(Dispatchers.Main) {
                AppState.track.clear()
                AppState.returnMode = false
                AppState.returnNext = null
                AppState.distance = 0.0
                AppState.ascent = 0.0
                AppState.descent = 0.0
                AppState.maxSpeed = 0f
                AppState.startTs = 0L
                AppState.rec = false
                AppState.putBool("rec", false)
                toast(if (ok) "Uscita inviata al telefono" else "Traccia vuota, scartata")
            }
        }
    }
}
