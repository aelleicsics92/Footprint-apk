package it.footprint.trail;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.Toast;

public class QuickWidget extends AppWidgetProvider {
    static final String A_WP = "it.footprint.trail.QUICK_WP", A_CAR = "it.footprint.trail.QUICK_CAR";

    private static PendingIntent bc(Context c, String action, int code) {
        Intent i = new Intent(c, QuickWidget.class).setAction(action);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quick);
            v.setOnClickPendingIntent(R.id.w_wp, bc(c, A_WP, 1));
            v.setOnClickPendingIntent(R.id.w_car, bc(c, A_CAR, 2));
            Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
            if (open != null) v.setOnClickPendingIntent(R.id.w_open, PendingIntent.getActivity(c, 3, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            m.updateAppWidget(id, v);
        }
    }

    @Override
    public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        String a = i.getAction();
        if (A_WP.equals(a)) Toast.makeText(c, QuickSave.save(c, "wp"), Toast.LENGTH_LONG).show();
        else if (A_CAR.equals(a)) Toast.makeText(c, QuickSave.save(c, "car"), Toast.LENGTH_LONG).show();
    }
}
