package it.footprint.trail.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

// ---------- Utilita' ----------

@Composable
fun T(
    text: String,
    color: Color,
    size: Int,
    bold: Boolean = false,
    modifier: Modifier = Modifier
) {
    BasicText(
        text = text,
        modifier = modifier,
        style = TextStyle(
            color = color,
            fontSize = size.sp,
            fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
            textAlign = TextAlign.Center
        ),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
    )
}

private fun mkPaint(size: Float, argb: Int): android.graphics.Paint = android.graphics.Paint().apply {
    isAntiAlias = true
    textAlign = android.graphics.Paint.Align.CENTER
    textSize = size
    typeface = android.graphics.Typeface.DEFAULT_BOLD
    color = argb
}

private fun DrawScope.drawWpIcon(icon: String, x: Float, y: Float, sz: Int, ring: Color?) {
    val img = Icons.get(icon)
    if (img != null) {
        drawImage(
            img,
            dstOffset = IntOffset((x - sz / 2f).roundToInt(), (y - sz / 2f).roundToInt()),
            dstSize = IntSize(sz, sz)
        )
    } else {
        drawCircle(Color.Gray, sz / 2f, Offset(x, y))
    }
    if (ring != null) drawCircle(ring, sz / 2f + 3f, Offset(x, y), style = Stroke(width = 3f))
}

private fun DrawScope.arrow(center: Offset, len: Float, color: Color, deg: Float) {
    rotate(deg, center) {
        val path = Path().apply {
            moveTo(center.x, center.y - len)
            lineTo(center.x + len * 0.55f, center.y + len * 0.7f)
            lineTo(center.x, center.y + len * 0.35f)
            lineTo(center.x - len * 0.55f, center.y + len * 0.7f)
            close()
        }
        drawPath(path, color)
    }
}

// ---------- Radice ----------

@Composable
fun FpRoot() {
    val p = Pal.of(AppState.theme)
    val ctx = LocalContext.current
    val focus = remember { FocusRequester() }
    var acc by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(AppState.ambient, AppState.wheelOpen) {
        runCatching { focus.requestFocus() }
    }
    LaunchedEffect(AppState.exitRequested) {
        if (AppState.exitRequested) {
            AppState.exitRequested = false
            ctx.stopService(android.content.Intent(ctx, TrackingService::class.java))
            (ctx as? android.app.Activity)?.finishAndRemoveTask()
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(p.bg)
            .onRotaryScrollEvent { e ->
                acc += e.verticalScrollPixels
                val step = AppState.rotaryPx
                val s = (acc / step).toInt()
                if (s != 0) {
                    acc -= s * step
                    Controls.rotary(s)
                }
                true
            }
            .focusRequester(focus)
            .focusable()
    ) {
        if (AppState.ambient) {
            AmbientScreen(p)
        } else {
            Box(
                Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        var tot = 0f
                        detectHorizontalDragGestures(
                            onDragStart = { tot = 0f },
                            onDragEnd = {
                                if (tot < -80f) Controls.nextScreen(1) else if (tot > 80f) Controls.nextScreen(-1)
                            },
                            onHorizontalDrag = { _, dx -> tot += dx }
                        )
                    }
            ) {
                when (AppState.screen) {
                    0 -> MapScreen(p)
                    1 -> TripScreen(p)
                    2 -> CompassScreen(p)
                    3 -> ListScreen(p)
                    else -> MenuScreen(p)
                }
            }
            if (AppState.wheelOpen) Wheel(p)
            ToastView(p)
            if (AppState.touchLock) LockOverlay(p)
        }
    }
}

@Composable
fun LockOverlay(p: Pal) {
    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val ev = awaitPointerEvent(PointerEventPass.Initial)
                        ev.changes.forEach { it.consume() }
                    }
                }
            }
    ) {
        T("BLOCCO", p.dim, 10, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp))
    }
}

@Composable
fun ToastView(p: Pal) {
    val m = AppState.toast ?: return
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
        Box(
            Modifier
                .padding(bottom = 34.dp, start = 30.dp, end = 30.dp)
                .background(Color(0xE6000000), RoundedCornerShape(16.dp))
                .border(2.dp, p.main, RoundedCornerShape(16.dp))
                .padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
            T(m, p.main, 15, true)
        }
    }
}

// ---------- Mappa ----------

@Composable
fun MapScreen(p: Pal) {
    val paint = remember { mkPaint(22f, 0xFFFFFFFF.toInt()) }
    Box(Modifier.fillMaxSize()) {
        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectDragGestures { change, d ->
                        change.consume()
                        AppState.panX -= d.x
                        AppState.panY -= d.y
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = {
                        AppState.panX = 0f
                        AppState.panY = 0f
                    })
                }
        ) { drawMap(p, paint) }

        val f = AppState.fix
        val info = (if (f != null) "±${f.acc.roundToInt()} m  " else "GPS...  ") + "z${AppState.zoom}"
        T(info, p.main, 12, true, Modifier.align(Alignment.TopCenter).padding(top = 10.dp))
        if (!TileCache.has) {
            T("nessuna mappa: invia dal telefono", p.dim, 10, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp))
        }
    }
}

private fun DrawScope.drawMap(p: Pal, paint: android.graphics.Paint) {
    @Suppress("UNUSED_VARIABLE") val ver = TileCache.version
    val z = AppState.zoom
    val ts = 256.0 * AppState.tileScale
    val n = ts * (1 shl z).toDouble()
    val c = AppState.center()

    fun wx(lon: Double) = (lon + 180.0) / 360.0 * n
    fun wy(lat: Double): Double {
        val s = sin(Math.toRadians(lat))
        return (0.5 - ln((1 + s) / (1 - s)) / (4 * PI)) * n
    }

    val cx = wx(c.lon) + AppState.panX
    val cy = wy(c.lat) + AppState.panY
    val w = size.width
    val h = size.height

    fun sx(lon: Double) = (wx(lon) - cx + w / 2.0).toFloat()
    fun sy(lat: Double) = (wy(lat) - cy + h / 2.0).toFloat()

    // Tile raster
    if (TileCache.has) {
        val x0 = floor((cx - w / 2.0) / ts).toInt()
        val x1 = floor((cx + w / 2.0) / ts).toInt()
        val y0 = floor((cy - h / 2.0) / ts).toInt()
        val y1 = floor((cy + h / 2.0) / ts).toInt()
        val maxT = 1 shl z
        val side = ts.roundToInt() + 1
        for (tx in x0..x1) {
            for (ty in y0..y1) {
                if (ty < 0 || ty >= maxT) continue
                val wrap = ((tx % maxT) + maxT) % maxT
                val img = TileCache.get(z, wrap, ty) ?: continue
                val ox = (tx * ts - cx + w / 2.0).roundToInt()
                val oy = (ty * ts - cy + h / 2.0).roundToInt()
                drawImage(img, dstOffset = IntOffset(ox, oy), dstSize = IntSize(side, side))
            }
        }
    } else {
        // Vista vettoriale: cerchi da 100 m e 500 m
        val mpp = 156543.03392 * cos(Math.toRadians(c.lat)) / (1 shl z) / AppState.tileScale
        val mid = Offset(w / 2f - AppState.panX, h / 2f - AppState.panY)
        for (m in doubleArrayOf(100.0, 500.0)) {
            val r = (m / mpp).toFloat()
            if (r in 8f..2000f) drawCircle(p.dim, r, mid, style = Stroke(width = 1.5f))
        }
    }

    // Tracce salvate sul telefono
    if (AppState.showSaved) {
        for (st in AppState.saved) {
            val path = Path()
            var first = true
            for (pt in st) {
                val x = sx(pt.lon)
                val y = sy(pt.lat)
                if (first) { path.moveTo(x, y); first = false } else path.lineTo(x, y)
            }
            drawPath(path, Color(0xFFFFA726).copy(alpha = 0.8f), style = Stroke(width = 3f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }

    // Traccia
    val tr = AppState.track
    if (tr.size > 1) {
        val path = Path()
        var first = true
        for (pt in tr) {
            val x = sx(pt.lon)
            val y = sy(pt.lat)
            if (first) {
                path.moveTo(x, y)
                first = false
            } else {
                path.lineTo(x, y)
            }
        }
        val ret = AppState.returnMode
        drawPath(
            path,
            if (ret) p.main else p.sec,
            style = Stroke(width = if (ret) 6f else 4f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        )
    }

    // Posizione propria (al centro, spostata se la mappa e' trascinata)
    val f = AppState.fix
    val px = if (f != null) sx(f.lon) else w / 2f
    val py = if (f != null) sy(f.lat) else h / 2f

    // Linea verso la destinazione
    val nt = AppState.navTarget()
    if (nt != null) {
        drawLine(
            p.main, Offset(px, py), Offset(sx(nt.lon), sy(nt.lat)),
            strokeWidth = 3f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 10f))
        )
    }

    // Waypoint
    for (wp in AppState.waypoints) {
        val x = sx(wp.lon)
        val y = sy(wp.lat)
        if (x < -30f || x > w + 30f || y < -30f || y > h + 30f) continue
        drawWpIcon(wp.icon, x, y, 42, if (wp.id == AppState.targetId) p.main else null)
    }

    // Freccia propria
    rotate(AppState.heading, Offset(px, py)) {
        val tri = Path().apply {
            moveTo(px, py - 17f)
            lineTo(px + 12f, py + 13f)
            lineTo(px, py + 6f)
            lineTo(px - 12f, py + 13f)
            close()
        }
        drawPath(tri, p.main)
        drawPath(tri, Color.Black, style = Stroke(width = 2f))
    }
}

// ---------- Computer di viaggio ----------

@Composable
fun TripScreen(p: Pal) {
    val f = AppState.fix
    val nt = AppState.navTarget()
    val kmh = if (f != null && !AppState.still) f.speed * 3.6f else 0f
    val alt = f?.alt?.roundToInt() ?: 0
    val elapsed = if (AppState.startTs > 0) System.currentTimeMillis() - AppState.startTs else 0L

    Column(
        Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.SpaceEvenly,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            T("%.1f".format(kmh), p.main, 38, true)
            T(" km/h", p.dim, 14)
        }
        Row(verticalAlignment = Alignment.Bottom) {
            T("$alt m", p.text, 22, true)
            T("  ↑${AppState.ascent.roundToInt()}  ↓${AppState.descent.roundToInt()}", p.dim, 13)
        }
        Row(verticalAlignment = Alignment.Bottom) {
            T("%.2f km".format(AppState.distance / 1000.0), p.text, 20, true)
            T("  " + Geo.fmtTime(elapsed), p.dim, 13)
        }
        if (nt != null && f != null) {
            val d = Geo.dist(f.lat, f.lon, nt.lat, nt.lon)
            val rel = ((Geo.bearing(f.lat, f.lon, nt.lat, nt.lon) - AppState.heading + 360.0) % 360.0).toFloat()
            Row(verticalAlignment = Alignment.CenterVertically) {
                Canvas(Modifier.size(34.dp)) { arrow(Offset(size.width / 2f, size.height / 2f), 14f, p.sec, rel) }
                T(" " + Geo.fmtDist(d), p.sec, 22, true)
            }
        }
        val rec = AppState.rec
        Box(
            Modifier
                .clip(RoundedCornerShape(50))
                .background(if (rec) p.dim.copy(alpha = 0.35f) else p.main)
                .clickable { Controls.recTap() }
                .padding(horizontal = 18.dp, vertical = 7.dp)
        ) {
            T(if (rec) "■ FINE E INVIA" else "● AVVIA TRACCIA", if (rec) p.text else Color.Black, 13, true)
        }
    }
}

// ---------- Bussola ----------

@Composable
fun CompassScreen(p: Pal) {
    val paint = remember { mkPaint(26f, 0xFFFFFFFF.toInt()) }
    val f = AppState.fix
    val nt = AppState.navTarget()
    Box(Modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize()) {
            val c = Offset(size.width / 2f, size.height / 2f)
            val r = min(c.x, c.y) - 18f
            val hd = AppState.heading
            rotate(-hd, c) {
                for (i in 0 until 36) {
                    val a = Math.toRadians(i * 10.0)
                    val long = i % 3 == 0
                    val r1 = r - if (long) 18f else 9f
                    drawLine(
                        if (i == 0) p.main else p.dim,
                        Offset(c.x + (r * sin(a)).toFloat(), c.y - (r * cos(a)).toFloat()),
                        Offset(c.x + (r1 * sin(a)).toFloat(), c.y - (r1 * cos(a)).toFloat()),
                        strokeWidth = if (long) 4f else 2f
                    )
                }
                paint.color = p.main.toArgb()
                val labels = listOf("N" to 0.0, "E" to 90.0, "S" to 180.0, "O" to 270.0)
                for ((s, deg) in labels) {
                    val a = Math.toRadians(deg)
                    val rr = r - 38f
                    drawContext.canvas.nativeCanvas.drawText(
                        s, c.x + (rr * sin(a)).toFloat(), c.y - (rr * cos(a)).toFloat() + 9f, paint
                    )
                }
            }
            // indicatore fisso in alto
            val tri = Path().apply {
                moveTo(c.x, c.y - r + 4f)
                lineTo(c.x - 9f, c.y - r - 12f)
                lineTo(c.x + 9f, c.y - r - 12f)
                close()
            }
            drawPath(tri, p.main)
            // freccia verso la destinazione
            if (nt != null && f != null) {
                val rel = (Geo.bearing(f.lat, f.lon, nt.lat, nt.lon) - hd + 360.0).toFloat() % 360f
                rotate(rel, c) {
                    drawLine(p.sec, c, Offset(c.x, c.y - r + 34f), strokeWidth = 7f, cap = StrokeCap.Round)
                    val head = Path().apply {
                        moveTo(c.x, c.y - r + 20f)
                        lineTo(c.x - 14f, c.y - r + 46f)
                        lineTo(c.x + 14f, c.y - r + 46f)
                        close()
                    }
                    drawPath(head, p.sec)
                }
            }
        }
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            val hd = AppState.heading.roundToInt() % 360
            T("$hd°", p.text, 34, true)
            T(Geo.card(hd.toDouble()), p.main, 18, true)
            if (nt != null && f != null) {
                T(Geo.fmtDist(Geo.dist(f.lat, f.lon, nt.lat, nt.lon)), p.sec, 18, true)
            }
        }
    }
}

// ---------- Ambient (always-on a basso consumo) ----------

@Composable
fun AmbientScreen(p: Pal) {
    val f = AppState.fix
    val nt = AppState.navTarget()
    val hd = AppState.shownHeading
    val col = Color(0xFF9A9A9A)
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        T("${hd.roundToInt() % 360}° ${Geo.card(hd.toDouble())}", col, 34)
        if (nt != null && f != null) {
            val rel = ((Geo.bearing(f.lat, f.lon, nt.lat, nt.lon) - hd + 360.0) % 360.0).toFloat()
            Canvas(Modifier.size(60.dp)) {
                val c = Offset(size.width / 2f, size.height / 2f)
                rotate(rel, c) {
                    val path = Path().apply {
                        moveTo(c.x, c.y - 24f)
                        lineTo(c.x + 14f, c.y + 18f)
                        lineTo(c.x, c.y + 8f)
                        lineTo(c.x - 14f, c.y + 18f)
                        close()
                    }
                    drawPath(path, col, style = Stroke(width = 2f))
                }
            }
            T(Geo.fmtDist(Geo.dist(f.lat, f.lon, nt.lat, nt.lon)), col, 22)
        } else if (f != null) {
            T("${(f.alt).roundToInt()} m", col, 22)
        }
    }
}

// ---------- Punti ----------

@Composable
fun ListScreen(p: Pal) {
    val l = Controls.sortedWps()
    val f = AppState.fix
    val sel = AppState.listSel.coerceIn(0, max(0, l.size - 1))
    Column(
        Modifier.fillMaxSize().padding(horizontal = 30.dp, vertical = 26.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        T("PUNTI (${l.size})", p.dim, 12, true)
        if (l.isEmpty()) {
            T("nessun waypoint", p.dim, 14)
        } else {
            val from = max(0, sel - 2)
            val to = min(l.size - 1, sel + 2)
            for (i in from..to) {
                val w = l[i]
                val selected = i == sel
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp)
                        .background(if (selected) p.main.copy(alpha = 0.22f) else Color.Transparent, RoundedCornerShape(10.dp))
                        .pointerInput(w.id) {
                            detectTapGestures(
                                onTap = {
                                    AppState.listSel = i
                                    Controls.activateSelection()
                                },
                                onLongPress = { Controls.deleteWp(w) }
                            )
                        }
                        .padding(horizontal = 6.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val ib = Icons.get(w.icon)
                    if (ib != null) {
                        Image(bitmap = ib, contentDescription = null, modifier = Modifier.size(30.dp))
                    } else {
                        Box(Modifier.size(30.dp).background(Color(0xFF777777), CircleShape), contentAlignment = Alignment.Center) {
                            T(Labels.of(w.icon).take(1), Color.White, 13, true)
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        T(w.title, if (selected) p.main else p.text, 14, selected)
                        if (f != null) T(Geo.fmtDist(Geo.dist(f.lat, f.lon, w.lat, w.lon)), p.dim, 11)
                    }
                }
            }
        }
    }
}

// ---------- Menu ----------

@Composable
fun MenuScreen(p: Pal) {
    val items = Controls.menuItems()
    val sel = AppState.menuSel.coerceIn(0, items.size - 1)
    Column(
        Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 26.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        T("MENU   tasto: ${Controls.keyName(AppState.lastKey)}", p.dim, 11, true)
        val from = max(0, sel - 2)
        val to = min(items.size - 1, sel + 2)
        for (i in from..to) {
            val selected = i == sel
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp)
                    .background(if (selected) p.main.copy(alpha = 0.22f) else Color.Transparent, RoundedCornerShape(10.dp))
                    .pointerInput(i) {
                        detectTapGestures(onTap = {
                            AppState.menuSel = i
                            Controls.activateSelection()
                        })
                    }
                    .padding(horizontal = 8.dp, vertical = 7.dp),
                contentAlignment = Alignment.Center
            ) {
                T(items[i].label, if (selected) p.main else p.text, 15, selected)
            }
        }
        if (AppState.learn != 0) T("premi il tasto da assegnare", p.sec, 12)
    }
}

// ---------- Menu a ruota ----------

@Composable
fun Wheel(p: Pal) {
    val items = Controls.wheel()
    val sel = AppState.wheelIndex.coerceIn(0, items.size - 1)
    val paint = remember { mkPaint(26f, 0xFFFFFFFF.toInt()) }
    Box(Modifier.fillMaxSize().background(Color(0xEE000000))) {
        Canvas(Modifier.fillMaxSize()) {
            val cx = size.width / 2f
            val cy = size.height / 2f
            val r = min(cx, cy) - 38f
            items.forEachIndexed { i, item ->
                val a = Math.toRadians(-90.0 + i * 360.0 / items.size)
                val x = cx + (r * cos(a)).toFloat()
                val y = cy + (r * sin(a)).toFloat()
                val s = i == sel
                if (!item.cmd) {
                    val many = items.size > 14
                    drawWpIcon(item.key, x, y, if (s) (if (many) 54 else 64) else (if (many) 34 else 40), null)
                    if (s) drawCircle(p.main, if (many) 33f else 38f, Offset(x, y), style = Stroke(width = 4f))
                } else {
                    drawCircle(Color(item.color), if (s) 30f else 19f, Offset(x, y))
                    if (s) drawCircle(p.main, 35f, Offset(x, y), style = Stroke(width = 4f))
                    paint.textSize = if (s) 30f else 20f
                    drawContext.canvas.nativeCanvas.drawText(item.letter, x, y + paint.textSize / 3f, paint)
                }
            }
        }
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            T(items[sel].label, p.main, 20, true)
            T("premi = conferma", p.dim, 12)
            T("tieni = annulla", p.dim, 12)
        }
    }
}
