package it.footprint.trail.wear

import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

data class Fix(
    val lat: Double,
    val lon: Double,
    val alt: Double,
    val acc: Float,
    val speed: Float,
    val bearing: Float,
    val ts: Long
)

data class LL(val lat: Double, val lon: Double)

data class Waypoint(
    val id: String,
    val icon: String,
    val title: String,
    val lat: Double,
    val lon: Double,
    val alt: Double,
    val acc: Float,
    val ts: Long,
    val dog: Boolean = false,
    val synced: Boolean = false,
    val deleted: Boolean = false
)

data class NavTarget(val lat: Double, val lon: Double, val name: String)

/** Tipo di waypoint sul watch. [icon] e' l'id icona usato dall'app del telefono. */
data class WType(
    val id: String,
    val label: String,
    val letter: String,
    val color: Long,
    val icon: String,
    val prefix: String
)

object Types {
    val all = listOf(
        WType("porcino", "Porcino", "P", 0xFF8A4B21, "porcino", "Porcino"),
        WType("baby", "Baby porcino", "b", 0xFFC58A4B, "porcino", "Baby porcino"),
        WType("tartufo", "Tartufo", "T", 0xFF5A4A3C, "scorzone", "Tartufo"),
        WType("auto", "Auto", "A", 0xFF1F6FB5, "parcheggio", "Auto parcheggiata"),
        WType("galletto", "Galletto", "G", 0xFFE2A017, "galletto", "Galletto"),
        WType("ovolo", "Ovolo", "O", 0xFFE2531F, "ovulo", "Ovolo"),
        WType("fungo", "Fungo", "F", 0xFFA88A5D, "fungo", "Fungo"),
        WType("acqua", "Acqua", "W", 0xFF3B9BD1, "acqua", "Sorgente"),
        WType("pericolo", "Pericolo", "!", 0xFFD9792A, "pericolo", "Pericolo"),
        WType("altro", "Altro", "o", 0xFF777777, "orma", "Punto")
    )

    private val truffle = setOf("scorzone", "uncinato", "bianco", "bianchetto", "nero")
    private val fungi = setOf(
        "regius", "prugnolo", "gambesecche", "chiodini", "pioppino", "prataiolo", "morchella",
        "steccherino", "trombetta", "pinarolo", "pinaiolo", "leccino", "cardoncello", "tignosa",
        "lactarius", "vescia", "russola", "mazza", "pleurotus"
    )

    fun byId(id: String): WType = all.firstOrNull { it.id == id } ?: all[0]

    fun forWp(w: Waypoint): WType {
        val ic = w.icon
        if (ic == "porcino") return byId(if (w.title.startsWith("Baby", true)) "baby" else "porcino")
        if (ic in truffle) return byId("tartufo")
        if (ic in fungi) return byId("fungo")
        return all.firstOrNull { it.icon == ic } ?: byId("altro")
    }
}

object Geo {
    private const val R = 6371000.0

    fun dist(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dp = p2 - p1
        val dl = Math.toRadians(lon2 - lon1)
        val h = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * R * atan2(sqrt(h), sqrt(1 - h))
    }

    fun bearing(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dl = Math.toRadians(lon2 - lon1)
        val y = sin(dl) * cos(p2)
        val x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    /** Proietta un punto lungo una rotta (usata per compensare il ritardo del fix GPS). */
    fun project(lat: Double, lon: Double, bearingDeg: Double, meters: Double): LL {
        val dr = meters / R
        val b = Math.toRadians(bearingDeg)
        val p1 = Math.toRadians(lat)
        val l1 = Math.toRadians(lon)
        val p2 = asin(sin(p1) * cos(dr) + cos(p1) * sin(dr) * cos(b))
        val l2 = l1 + atan2(sin(b) * sin(dr) * cos(p1), cos(dr) - sin(p1) * sin(p2))
        return LL(Math.toDegrees(p2), Math.toDegrees(l2))
    }

    fun card(h: Double): String {
        val names = listOf("N", "NE", "E", "SE", "S", "SO", "O", "NO")
        return names[(((h + 22.5) % 360.0) / 45.0).toInt().coerceIn(0, 7)]
    }

    fun fmtDist(m: Double): String =
        if (m < 1000.0) "${m.roundToInt()} m" else "%.1f km".format(m / 1000.0)

    fun fmtTime(ms: Long): String {
        val s = ms / 1000
        val h = s / 3600
        val m = (s % 3600) / 60
        return if (h > 0) "%d:%02d h".format(h, m) else "%d min".format(m)
    }
}
