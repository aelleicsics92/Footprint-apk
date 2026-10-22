package it.footprint.trail;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import org.json.JSONArray;
import org.json.JSONObject;

/** Salvataggio rapido di un punto (waypoint o auto) da tile o widget, senza aprire l'app. */
public class QuickSave {
    static final String PREFS = "fp_quick";

    public static String save(Context c, String type) {
        String label = "car".equals(type) ? "Auto" : "Waypoint";
        try {
            JSONObject o = new JSONObject();
            o.put("type", type);
            o.put("ts", System.currentTimeMillis());
            Location best = null;
            if (c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
                for (String p : lm.getProviders(true)) {
                    Location l = lm.getLastKnownLocation(p);
                    if (l == null) continue;
                    if (System.currentTimeMillis() - l.getTime() > 5 * 60000) continue;
                    if (best == null || l.getAccuracy() < best.getAccuracy()) best = l;
                }
            }
            String msg;
            if (best != null) {
                o.put("lat", best.getLatitude());
                o.put("lon", best.getLongitude());
                o.put("alt", best.hasAltitude() ? best.getAltitude() : JSONObject.NULL);
                o.put("acc", best.getAccuracy());
                o.put("needFix", false);
                msg = label + " salvato (±" + Math.round(best.getAccuracy()) + " m)";
            } else {
                o.put("needFix", true);
                msg = label + ": posizione non disponibile, lo completo quando apri Footprint";
            }
            SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString("items", "[]"));
            arr.put(o);
            sp.edit().putString("items", arr.toString()).apply();
            return msg;
        } catch (Exception e) {
            return "Salvataggio non riuscito";
        }
    }

    public static String take(Context c) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String s = sp.getString("items", "[]");
        sp.edit().remove("items").apply();
        return s;
    }
}
