package it.footprint.trail;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

/** Widget 4x2: indice cacciata, luce residua e 4 azioni rapide. I dati li invia l'app. */
public class MainWidget extends AppWidgetProvider {
    static final String PREFS = "fp_widget";

    public static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, MainWidget.class));
        if (ids.length > 0) new MainWidget().onUpdate(c, m, ids);
    }

    private static PendingIntent act(Context c, String action, int code) {
        Intent i = new Intent(c, MainActivity.class);
        i.putExtra("fp_action", action);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject d;
        try { d = new JSONObject(sp.getString("data", "{}")); } catch (Exception e) { d = new JSONObject(); }
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_main);
            String place = d.optString("place", "");
            String alt = d.has("alt") && !d.isNull("alt") ? Math.round(d.optDouble("alt")) + " m" : "";
            String head = (place.isEmpty() ? "" : place) + (!place.isEmpty() && !alt.isEmpty() ? " • " : "") + alt;
            v.setTextViewText(R.id.w_place, head.isEmpty() ? "apri l'app" : head);
            if (d.has("score")) {
                v.setTextViewText(R.id.w_score, d.optInt("score") + " " + d.optString("label", ""));
                v.setTextViewText(R.id.w_prof, d.optString("profile", ""));
                int res = c.getResources().getIdentifier("w_" + d.optString("icon", "porcino"), "drawable", c.getPackageName());
                if (res != 0) v.setImageViewResource(R.id.w_icon, res);
            } else {
                v.setTextViewText(R.id.w_score, "--");
                v.setTextViewText(R.id.w_prof, "apri l'app per aggiornare");
            }
            long ss = d.optLong("sunset", 0);
            if (ss > 0) {
                v.setTextViewText(R.id.w_sun, "Tramonto " + new SimpleDateFormat("HH:mm", Locale.ITALY).format(new Date(ss)));
                long left = ss - System.currentTimeMillis();
                if (left <= 0) v.setTextViewText(R.id.w_left, "È buio");
                else v.setTextViewText(R.id.w_left, "~" + (left / 3600000) + "h " + ((left / 60000) % 60) + "m di luce");
            } else {
                v.setTextViewText(R.id.w_sun, "--");
                v.setTextViewText(R.id.w_left, "");
            }
            boolean rec = d.optBoolean("rec", false);
            v.setTextViewText(R.id.w_rec_t, rec ? "Stop" : "Traccia");
            v.setImageViewResource(R.id.w_rec_ic, rec ? R.drawable.w_ic_stop : R.drawable.w_ic_play);
            v.setOnClickPendingIntent(R.id.w_wp, act(c, "wp", 11));
            v.setOnClickPendingIntent(R.id.w_car, act(c, "car", 12));
            v.setOnClickPendingIntent(R.id.w_rec, act(c, "rec", 13));
            v.setOnClickPendingIntent(R.id.w_sos, act(c, "sos", 14));
            v.setOnClickPendingIntent(R.id.w_card1, act(c, "fungi", 15));
            m.updateAppWidget(id, v);
        }
    }
}
