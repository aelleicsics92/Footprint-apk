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
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;
import java.io.File;
import java.io.FileWriter;
import java.io.BufferedReader;
import java.io.FileReader;

public class RecService extends Service implements LocationListener {
    static final String PREFS = "fp_rec";
    static final String CH = "fp_rec_ch";
    private LocationManager lm;
    private PowerManager.WakeLock wl;
    private Location last;

    static File logFile(Context c) { return new File(c.getFilesDir(), "rec.jsonl"); }

    static void start(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("active", true).apply();
        Intent i = new Intent(c, RecService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("active", false).apply();
        c.stopService(new Intent(c, RecService.class));
    }

    static String read(Context c) {
        StringBuilder sb = new StringBuilder("[");
        File f = logFile(c);
        if (f.exists()) {
            try (BufferedReader r = new BufferedReader(new FileReader(f))) {
                String l; boolean first = true;
                while ((l = r.readLine()) != null) {
                    l = l.trim();
                    if (!l.startsWith("[") || !l.endsWith("]")) continue;
                    if (!first) sb.append(',');
                    sb.append(l); first = false;
                }
            } catch (Exception ignore) {}
        }
        return sb.append(']').toString();
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!sp.getBoolean("active", false)) { stopSelf(); return START_NOT_STICKY; }
        if (intent != null && "it.footprint.trail.SAVEWP".equals(intent.getAction())) {
            try { android.widget.Toast.makeText(this, QuickSave.save(this, "wp"), android.widget.Toast.LENGTH_LONG).show(); } catch (Exception ignore) {}
            try { android.os.Vibrator vb = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE); if (vb != null) vb.vibrate(60); } catch (Exception ignore) {}
        }
        notifyFg();
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (wl == null && pm != null) { wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "footprint:rec"); wl.acquire(); }
        } catch (Exception ignore) {}
        try {
            lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            lm.removeUpdates(this);
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 3, this);
            try { lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10000, 20, this); } catch (Exception ignore) {}
        } catch (SecurityException e) { stopSelf(); } catch (Exception ignore) {}
        return START_STICKY;
    }

    private void notifyFg() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) nm.createNotificationChannel(new NotificationChannel(CH, "Registrazione traccia", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        int fl = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, fl);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setContentTitle("Footprint: registrazione traccia").setContentText("La traccia GPS è in registrazione, continua anche a schermo spento")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).setContentIntent(pi);
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(7701, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(7701, n);
    }

    @Override
    public void onLocationChanged(Location l) {
        if (l == null) return;
        if (l.hasAccuracy() && l.getAccuracy() > 45) return;
        if (last != null && last.distanceTo(l) < 3 && l.getTime() - last.getTime() < 15000) return;
        last = l;
        try (FileWriter w = new FileWriter(logFile(this), true)) {
            w.write("[" + l.getLatitude() + "," + l.getLongitude() + "," + (l.hasAltitude() ? String.valueOf(l.getAltitude()) : "null") + "," + l.getTime() + "]\n");
        } catch (Exception ignore) {}
    }

    @Override public void onStatusChanged(String p, int s, Bundle b) {}
    @Override public void onProviderEnabled(String p) {}
    @Override public void onProviderDisabled(String p) {}

    @Override
    public void onDestroy() {
        try { if (lm != null) lm.removeUpdates(this); } catch (Exception ignore) {}
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception ignore) {}
        super.onDestroy();
    }
}
