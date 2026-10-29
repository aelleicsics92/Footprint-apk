package it.footprint.trail;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Radar compagni offline: emette (a basso consumo) la presenza del gruppo e, su richiesta, scambia le coordinate via Nearby Connections. */
public class MateService extends Service {
    static final String PREFS = "fp_mate";
    static final String SID = "it.footprint.trail.mates";
    static final String CH = "fp_mate_ch";
    static volatile boolean searching = false;
    static volatile MateService inst;

    private ConnectionsClient cc;
    private static class G { String key, hash, tag, name; }
    private final List<G> groups = new ArrayList<>();
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Map<String, List<String>> common = new HashMap<>();
    private final Map<String, Long> reqAt = new HashMap<>();
    private boolean advertising = false;

    interface LocCb { void on(Location l); }

    static String sha(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) { return s; }
    }

    static void start(Context c, String groupsJson) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("active", true).putString("groups", groupsJson).apply();
        Intent i = new Intent(c, MateService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("active", false).apply();
        c.stopService(new Intent(c, MateService.class));
    }

    static void search(Context c, int seconds) {
        MateService s = inst;
        if (s != null) s.startSearch(seconds);
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!sp.getBoolean("active", false)) { stopSelf(); return START_NOT_STICKY; }
        groups.clear();
        try {
            JSONArray arr = new JSONArray(sp.getString("groups", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                G g = new G();
                g.key = o.getString("key");
                g.name = o.optString("name", "Io");
                g.hash = sha(g.key);
                g.tag = g.hash.substring(0, 6);
                groups.add(g);
            }
        } catch (Exception ignore) {}
        if (groups.isEmpty()) { stopSelf(); return START_NOT_STICKY; }
        inst = this;
        try { notifyFg(); } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        cc = Nearby.getConnectionsClient(this);
        try { cc.stopAdvertising(); } catch (Exception ignore) {}
        advertising = false;
        startAdv();
        return START_STICKY;
    }

    private void notifyFg() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) nm.createNotificationChannel(new NotificationChannel(CH, "Radar compagni", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setContentTitle("Footprint: visibile ai compagni").setContentText("Il gruppo può cercarti anche senza internet")
            .setSmallIcon(android.R.drawable.ic_menu_share).setOngoing(true).setContentIntent(pi);
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) {
            int t = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE | ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            startForeground(7702, n, t);
        } else startForeground(7702, n);
    }

    private String advName() {
        StringBuilder sb = new StringBuilder();
        for (G g : groups) { if (sb.length() > 0) sb.append(','); sb.append(g.tag); }
        return sb.append('|').toString();
    }

    // gruppi in comune con un endpoint (nome = "tag1,tag2|")
    private List<String> commonTags(String endpointName) {
        List<String> out = new ArrayList<>();
        if (endpointName == null) return out;
        int i = endpointName.indexOf('|');
        if (i < 0) return out;
        for (String t : endpointName.substring(0, i).split(",")) {
            for (G g : groups) if (g.tag.equals(t) && !out.contains(t)) out.add(t);
        }
        return out;
    }

    private void startAdv() {
        if (advertising || cc == null) return;
        try {
            cc.startAdvertising(advName(), SID, life, new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build())
                .addOnSuccessListener(v -> advertising = true)
                .addOnFailureListener(e -> { advertising = false; h.postDelayed(this::startAdv, 30000); });
        } catch (Exception e) { h.postDelayed(this::startAdv, 30000); }
    }

    void startSearch(int seconds) {
        if (cc == null) return;
        searching = true;
        event("searching", true);
        try { cc.stopDiscovery(); } catch (Exception ignore) {}
        try {
            cc.startDiscovery(SID, disc, new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build())
                .addOnFailureListener(e -> { searching = false; event("searching", false); });
        } catch (Exception e) { searching = false; event("searching", false); }
        h.removeCallbacks(stopSearch);
        h.postDelayed(stopSearch, Math.max(15, seconds) * 1000L);
    }

    private final Runnable stopSearch = new Runnable() {
        @Override public void run() {
            try { if (cc != null) cc.stopDiscovery(); } catch (Exception ignore) {}
            searching = false;
            event("searching", false);
        }
    };

    private final EndpointDiscoveryCallback disc = new EndpointDiscoveryCallback() {
        @Override public void onEndpointFound(String id, DiscoveredEndpointInfo info) {
            if (commonTags(info.getEndpointName()).isEmpty()) return;
            long now = System.currentTimeMillis();
            Long last = reqAt.get(id);
            if (last != null && now - last < 15000) return;
            reqAt.put(id, now);
            cc.requestConnection(advName(), id, life);
        }
        @Override public void onEndpointLost(String id) {}
    };

    private final ConnectionLifecycleCallback life = new ConnectionLifecycleCallback() {
        @Override public void onConnectionInitiated(String id, ConnectionInfo info) {
            List<String> c = commonTags(info.getEndpointName());
            if (c.isEmpty()) { cc.rejectConnection(id); return; }
            common.put(id, c);
            cc.acceptConnection(id, pay);
        }
        @Override public void onConnectionResult(String id, ConnectionResolution r) {
            if (r.getStatus().getStatusCode() == ConnectionsStatusCodes.STATUS_OK) {
                sendPos(id);
                h.postDelayed(() -> { try { cc.disconnectFromEndpoint(id); } catch (Exception ignore) {} }, 6000);
            }
        }
        @Override public void onDisconnected(String id) { common.remove(id); }
    };

    private final PayloadCallback pay = new PayloadCallback() {
        @Override public void onPayloadReceived(String id, Payload p) {
            try {
                byte[] b = p.asBytes();
                if (b == null) return;
                JSONObject j = new JSONObject(new String(b, StandardCharsets.UTF_8));
                G gr = null;
                for (G g : groups) if (g.hash.equals(j.optString("k"))) gr = g;
                if (gr == null) return;
                String name = j.optString("n", "Compagno");
                JSONObject m = new JSONObject();
                m.put("name", name);
                m.put("gkey", gr.key);
                m.put("lat", j.getDouble("lat"));
                m.put("lon", j.getDouble("lon"));
                m.put("alt", j.opt("alt"));
                m.put("t", j.optLong("t", System.currentTimeMillis()));
                m.put("rx", System.currentTimeMillis());
                SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                JSONObject all = new JSONObject(sp.getString("mates", "{}"));
                all.put(gr.key + ":" + name, m);
                sp.edit().putString("mates", all.toString()).apply();
                JSObject ev = new JSObject();
                ev.put("name", name);
                ev.put("gkey", gr.key);
                ev.put("lat", m.getDouble("lat"));
                ev.put("lon", m.getDouble("lon"));
                ev.put("t", m.getLong("t"));
                IntentFilesPlugin.mateEvent("mate", ev);
            } catch (Exception ignore) {}
        }
        @Override public void onPayloadTransferUpdate(String id, PayloadTransferUpdate u) {}
    };

    private void sendPos(String id) {
        final List<String> tags = common.get(id);
        if (tags == null) return;
        withLoc(l -> {
            try {
                if (l == null) return;
                for (G g : groups) {
                    if (!tags.contains(g.tag)) continue;
                    JSONObject j = new JSONObject();
                    j.put("k", g.hash);
                    j.put("n", g.name);
                    j.put("lat", l.getLatitude());
                    j.put("lon", l.getLongitude());
                    if (l.hasAltitude()) j.put("alt", l.getAltitude());
                    j.put("t", l.getTime() > 0 ? l.getTime() : System.currentTimeMillis());
                    cc.sendPayload(id, Payload.fromBytes(j.toString().getBytes(StandardCharsets.UTF_8)));
                }
            } catch (Exception ignore) {}
        });
    }

    private Location bestLast() {
        Location best = null;
        try {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            for (String p : lm.getAllProviders()) {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
        } catch (Exception ignore) {}
        return best;
    }

    private void withLoc(LocCb cb) {
        final boolean[] done = {false};
        final Location fb = bestLast();
        Runnable fin = () -> { if (!done[0]) { done[0] = true; cb.on(fb); } };
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                CancellationSignal cs = new CancellationSignal();
                h.postDelayed(() -> { cs.cancel(); fin.run(); }, 8000);
                lm.getCurrentLocation(LocationManager.GPS_PROVIDER, cs, getMainExecutor(), l -> {
                    if (done[0]) return;
                    done[0] = true;
                    cb.on(l != null ? l : fb);
                });
                return;
            } catch (Exception ignore) {}
        }
        fin.run();
    }

    static void event(String type, boolean v) {
        JSObject ev = new JSObject();
        ev.put("searching", v);
        IntentFilesPlugin.mateEvent(type, ev);
    }

    @Override
    public void onDestroy() {
        h.removeCallbacksAndMessages(null);
        try { if (cc != null) { cc.stopAdvertising(); cc.stopDiscovery(); cc.stopAllEndpoints(); } } catch (Exception ignore) {}
        searching = false;
        inst = null;
        super.onDestroy();
    }
}
