package it.footprint.trail.wear

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

object Store {
    lateinit var db: Db
    fun init(c: Context) {
        db = Db(c.applicationContext)
    }
}

data class TrackPt(val lat: Double, val lon: Double, val alt: Double, val ts: Long)

class Db(ctx: Context) : SQLiteOpenHelper(ctx, "fp.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE wp (id TEXT PRIMARY KEY, icon TEXT, title TEXT, lat REAL, lon REAL, alt REAL, " +
                "acc REAL, ts INTEGER, dog INTEGER, synced INTEGER, deleted INTEGER)"
        )
        db.execSQL("CREATE TABLE track (id INTEGER PRIMARY KEY AUTOINCREMENT, lat REAL, lon REAL, alt REAL, ts INTEGER)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    private fun cv(w: Waypoint) = ContentValues().apply {
        put("id", w.id)
        put("icon", w.icon)
        put("title", w.title)
        put("lat", w.lat)
        put("lon", w.lon)
        put("alt", w.alt)
        put("acc", w.acc.toDouble())
        put("ts", w.ts)
        put("dog", if (w.dog) 1 else 0)
        put("synced", if (w.synced) 1 else 0)
        put("deleted", if (w.deleted) 1 else 0)
    }

    private fun read(c: Cursor) = Waypoint(
        id = c.getString(0),
        icon = c.getString(1) ?: "fungo",
        title = c.getString(2) ?: "",
        lat = c.getDouble(3),
        lon = c.getDouble(4),
        alt = c.getDouble(5),
        acc = c.getFloat(6),
        ts = c.getLong(7),
        dog = c.getInt(8) == 1,
        synced = c.getInt(9) == 1,
        deleted = c.getInt(10) == 1
    )

    private val cols = "id,icon,title,lat,lon,alt,acc,ts,dog,synced,deleted"

    @Synchronized
    fun upsert(w: Waypoint) {
        writableDatabase.insertWithOnConflict("wp", null, cv(w), SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun allWp(): List<Waypoint> {
        val out = ArrayList<Waypoint>()
        readableDatabase.rawQuery("SELECT $cols FROM wp WHERE deleted=0 ORDER BY ts ASC", null).use { c ->
            while (c.moveToNext()) out.add(read(c))
        }
        return out
    }

    @Synchronized
    fun unsynced(): List<Waypoint> {
        val out = ArrayList<Waypoint>()
        readableDatabase.rawQuery("SELECT $cols FROM wp WHERE synced=0", null).use { c ->
            while (c.moveToNext()) out.add(read(c))
        }
        return out
    }

    @Synchronized
    fun getWp(id: String): Waypoint? {
        readableDatabase.rawQuery("SELECT $cols FROM wp WHERE id=?", arrayOf(id)).use { c ->
            return if (c.moveToFirst()) read(c) else null
        }
    }

    @Synchronized
    fun markSynced(id: String) {
        writableDatabase.execSQL("UPDATE wp SET synced=1 WHERE id=?", arrayOf(id))
    }

    @Synchronized
    fun softDelete(id: String, synced: Boolean) {
        writableDatabase.execSQL(
            "UPDATE wp SET deleted=1, synced=? WHERE id=?",
            arrayOf<Any>(if (synced) 1 else 0, id)
        )
    }

    @Synchronized
    fun addTrack(p: TrackPt) {
        writableDatabase.execSQL(
            "INSERT INTO track (lat,lon,alt,ts) VALUES (?,?,?,?)",
            arrayOf<Any>(p.lat, p.lon, p.alt, p.ts)
        )
    }

    @Synchronized
    fun loadTrack(): List<TrackPt> {
        val out = ArrayList<TrackPt>()
        readableDatabase.rawQuery("SELECT lat,lon,alt,ts FROM track ORDER BY id ASC", null).use { c ->
            while (c.moveToNext()) out.add(TrackPt(c.getDouble(0), c.getDouble(1), c.getDouble(2), c.getLong(3)))
        }
        return out
    }

    @Synchronized
    fun clearTrack() {
        writableDatabase.execSQL("DELETE FROM track")
    }
}
