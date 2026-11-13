package it.footprint.trail;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.content.SharedPreferences;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.Asset;
import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataMap;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.zip.GZIPInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Riceve dal watch waypoint (/fp/wp/) e uscite (/fp/trip/) anche ad app chiusa, e li tiene in coda finche' l'app li legge. */
public class WatchListener extends WearableListenerService {
    static final String PREFS = "fp_watch";

    @Override
    public void onDataChanged(DataEventBuffer events) {
        for (DataEvent e : events) {
            if (e.getType() != DataEvent.TYPE_CHANGED) continue;
            String path = e.getDataItem().getUri().getPath();
            if (path == null) continue;
            try {
                DataMap m = DataMapItem.fromDataItem(e.getDataItem()).getDataMap();
                if (path.startsWith("/fp/wp/")) addWp(this, m);
                else if (path.startsWith("/fp/trip/")) addTrip(this, m);
            } catch (Exception ex) {
                // dato non valido: ignorato
            }
        }
    }

    private static synchronized void addWp(Context c, DataMap m) throws Exception {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray old = new JSONArray(sp.getString("wps", "[]"));
        String id = m.getString("id");
        if (id == null) return;
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("icon", m.getString("icon"));
        o.put("title", m.getString("title"));
        o.put("lat", m.getDouble("lat"));
        o.put("lon", m.getDouble("lon"));
        o.put("alt", m.getDouble("alt"));
        o.put("acc", m.getFloat("acc"));
        o.put("ts", m.getLong("ts"));
        o.put("dog", m.getBoolean("dog"));
        o.put("del", m.getBoolean("del"));
        JSONArray out = new JSONArray();
        for (int i = 0; i < old.length(); i++) {
            if (!id.equals(old.getJSONObject(i).optString("id"))) out.put(old.get(i));
        }
        out.put(o);
        sp.edit().putString("wps", out.toString()).apply();
        if ("parcheggio".equals(m.getString("icon")) && !m.getBoolean("del")) notifyCar(c);
    }

    /** Se l'app e' chiusa la condivisione dell'auto parte quando si apre: la notifica la riapre con un tocco. */
    private static void notifyCar(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel("fp_watch_car", "Auto dal watch", NotificationManager.IMPORTANCE_HIGH));
            Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
            if (i == null) return;
            PendingIntent pi = PendingIntent.getActivity(c, 78, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "fp_watch_car") : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("Auto parcheggiata dal watch")
                .setContentText("Tocca per condividere la posizione dell'auto").setContentIntent(pi).setAutoCancel(true);
            nm.notify(78, b.build());
        } catch (Exception ignore) {
        }
    }

    private void addTrip(Context c, DataMap m) throws Exception {
        Asset a = m.getAsset("track");
        String csv = "";
        if (a != null) {
            DataClient.GetFdForAssetResponse r = Tasks.await(Wearable.getDataClient(c).getFdForAsset(a));
            try (InputStream in = new GZIPInputStream(r.getInputStream())) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0 && bos.size() < 3_000_000) bos.write(buf, 0, n);
                csv = bos.toString("UTF-8");
            }
        }
        JSONObject o = new JSONObject();
        o.put("start", m.getLong("start"));
        o.put("end", m.getLong("end"));
        o.put("dist", m.getDouble("dist"));
        o.put("up", m.getDouble("up"));
        o.put("down", m.getDouble("down"));
        o.put("maxSpeed", m.getFloat("maxSpeed"));
        o.put("csv", csv);
        addTripJson(c, o);
    }

    private static synchronized void addTripJson(Context c, JSONObject o) throws Exception {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray old = new JSONArray(sp.getString("trips", "[]"));
        long start = o.getLong("start");
        JSONArray out = new JSONArray();
        for (int i = 0; i < old.length(); i++) {
            if (old.getJSONObject(i).optLong("start") != start) out.put(old.get(i));
        }
        out.put(o);
        sp.edit().putString("trips", out.toString()).apply();
    }

    /** Svuota la coda e restituisce [waypoint JSON, uscite JSON]. */
    static synchronized String[] take(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String w = sp.getString("wps", "[]");
        String t = sp.getString("trips", "[]");
        sp.edit().remove("wps").remove("trips").apply();
        return new String[]{w, t};
    }
}
