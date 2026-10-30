package it.footprint.trail;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.Vibrator;
import android.widget.Toast;

/** Barra rapida: notifica fissa con "Segna punto" e "Auto". Tiene viva l'app per una riapertura istantanea. Nessun GPS acceso. */
public class KeepService extends Service {
    static final String CH = "fp_keep_ch";
    static final String A_WP = "it.footprint.trail.KEEP_WP", A_CAR = "it.footprint.trail.KEEP_CAR";

    static void start(Context c) {
        Intent i = new Intent(c, KeepService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }
    static void stop(Context c) { c.stopService(new Intent(c, KeepService.class)); }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) nm.createNotificationChannel(new NotificationChannel(CH, "Barra rapida", NotificationManager.IMPORTANCE_LOW));
        int fl = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK), fl);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setContentTitle("Footprint pronto").setContentText("Tocca per aprire subito la mappa")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).setContentIntent(open);
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(7702, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(7702, n);
        } catch (Exception e) { stopSelf(); }
        return START_STICKY;
    }
}
