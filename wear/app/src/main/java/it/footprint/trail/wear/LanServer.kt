package it.footprint.trail.wear

import android.content.Context
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID

/**
 * Ricezione mappe via WiFi: finche' l'app e' aperta il watch ascolta su una porta locale e
 * pubblica ip, porta e token (via Data Layer, canale gia' associato) per il telefono.
 * Il telefono, se e' sulla stessa rete, spedisce lo ZIP direttamente; altrimenti usa il Bluetooth.
 */
object LanServer {
    private var ss: ServerSocket? = null
    private val token = UUID.randomUUID().toString().replace("-", "")

    fun localIp(): String? {
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp || ni.isLoopback || !ni.name.startsWith("wlan")) continue
                for (a in ni.inetAddresses) if (a is Inet4Address && a.isSiteLocalAddress) return a.hostAddress
            }
        } catch (e: Exception) { }
        return null
    }

    @Synchronized
    fun start(ctx: Context) {
        val ip = localIp()
        if (ip == null) { publish(ctx, null); return }
        if (ss == null) {
            val s = try { ServerSocket(0) } catch (e: Exception) { return }
            ss = s
            Thread {
                while (!s.isClosed) {
                    try { val c = s.accept(); Thread { handle(ctx, c) }.start() } catch (e: Exception) { break }
                }
            }.start()
        }
        publish(ctx, ip)
    }

    @Synchronized
    fun stop(ctx: Context) {
        try { ss?.close() } catch (e: Exception) { }
        ss = null
        publish(ctx, null)
    }

    private fun publish(ctx: Context, ip: String?) {
        try {
            val dc = Wearable.getDataClient(ctx)
            if (ip == null) {
                dc.deleteDataItems(android.net.Uri.parse("wear://*" + Sync.LAN))
            } else {
                val req = PutDataMapRequest.create(Sync.LAN)
                req.dataMap.putString("ip", ip)
                req.dataMap.putInt("port", ss?.localPort ?: 0)
                req.dataMap.putString("token", token)
                req.dataMap.putLong("ts", System.currentTimeMillis())
                dc.putDataItem(req.asPutDataRequest().setUrgent())
            }
        } catch (e: Exception) { }
    }

    private fun handle(ctx: Context, c: Socket) {
        try {
            c.soTimeout = 30000
            val inp = c.getInputStream().buffered()
            val head = StringBuilder()
            while (head.length < 4096 && !head.endsWith("\r\n\r\n")) {
                val b = inp.read()
                if (b < 0) return
                head.append(b.toChar())
            }
            val h = head.toString().split("\r\n")
            var len = -1L
            var tk = ""
            for (l in h) {
                val i = l.indexOf(':')
                if (i < 0) continue
                val k = l.substring(0, i).trim().lowercase()
                val v = l.substring(i + 1).trim()
                if (k == "content-length") len = v.toLongOrNull() ?: -1
                if (k == "x-token") tk = v
            }
            val out = c.getOutputStream()
            if (!h[0].startsWith("POST /tiles") || tk != token || len <= 0) {
                out.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n".toByteArray()); out.flush(); return
            }
            AppState.scope.launch(Dispatchers.Main) { Controls.toast("Ricevo mappe (WiFi)...") }
            val tmp = File(ctx.cacheDir, "tiles_lan.zip")
            var left = len
            val buf = ByteArray(65536)
            tmp.outputStream().use { fo ->
                while (left > 0) {
                    val r = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (r < 0) break
                    fo.write(buf, 0, r)
                    left -= r
                }
            }
            if (left > 0) {
                tmp.delete()
                out.write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n".toByteArray()); out.flush(); return
            }
            out.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); out.flush()
            AppState.scope.launch(Dispatchers.IO) { finishTiles(ctx.applicationContext, tmp) }
        } catch (e: Exception) {
        } finally {
            try { c.close() } catch (e: Exception) { }
        }
    }
}
