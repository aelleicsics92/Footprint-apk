package it.footprint.trail;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.provider.OpenableColumns;
import androidx.core.content.FileProvider;
import java.io.File;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** Riceve file GPX/KML aperti o condivisi con Footprint (es. da Garmin Explore o dal file manager). */
@CapacitorPlugin(name = "IntentFiles")
public class IntentFilesPlugin extends Plugin {
    private static final List<JSObject> pending = new ArrayList<>();
    private static final int MAX_BYTES = 12 * 1024 * 1024;

    public static synchronized List<JSObject> collect(Context ctx, Intent it) {
        List<JSObject> found = new ArrayList<>();
        if (it == null || it.getAction() == null) return found;
        List<Uri> uris = new ArrayList<>();
        String a = it.getAction();
        try {
            if (Intent.ACTION_VIEW.equals(a) && it.getData() != null) uris.add(it.getData());
            else if (Intent.ACTION_SEND.equals(a)) {
                Uri u = it.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(a)) {
                ArrayList<Uri> l = it.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (l != null) uris.addAll(l);
            }
            if (uris.isEmpty() && it.getClipData() != null) {
                ClipData cd = it.getClipData();
                for (int i = 0; i < cd.getItemCount(); i++) if (cd.getItemAt(i).getUri() != null) uris.add(cd.getItemAt(i).getUri());
            }
        } catch (Exception e) {
            return found;
        }
        for (Uri u : uris) {
            try {
                String name = "file";
                try (Cursor c = ctx.getContentResolver().query(u, null, null, null, null)) {
                    if (c != null && c.moveToFirst()) {
                        int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (i >= 0) name = c.getString(i);
                    }
                } catch (Exception ignore) {
                    String p = u.getLastPathSegment();
                    if (p != null) name = p;
                }
                try (InputStream in = ctx.getContentResolver().openInputStream(u)) {
                    if (in == null) continue;
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n, total = 0;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_BYTES) break;
                        out.write(buf, 0, n);
                    }
                    JSObject o = new JSObject();
                    o.put("name", name);
                    o.put("text", out.toString("UTF-8"));
                    found.add(o);
                }
            } catch (Exception ignore) {
            }
        }
        pending.addAll(found);
        return found;
    }

    public void deliver() {
        JSObject r = takeAll();
        Object arr = r.opt("files");
        if (arr instanceof JSArray && ((JSArray) arr).length() > 0) notifyListeners("files", r, true);
    }

    private static synchronized JSObject takeAll() {
        JSArray arr = new JSArray();
        for (JSObject o : pending) arr.put(o);
        pending.clear();
        JSObject r = new JSObject();
        r.put("files", arr);
        return r;
    }

    public static volatile boolean volumeKey = false;
    public static volatile String action = null;

    @PluginMethod
    public void recStart(PluginCall call) {
        try { RecService.start(getContext()); call.resolve(); } catch (Exception e) { call.reject(String.valueOf(e)); }
    }

    @PluginMethod
    public void recStop(PluginCall call) {
        RecService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void recRead(PluginCall call) {
        JSObject r = new JSObject();
        try { r.put("points", new JSArray(RecService.read(getContext()))); } catch (Exception e) { r.put("points", new JSArray()); }
        r.put("active", getContext().getSharedPreferences(RecService.PREFS, Context.MODE_PRIVATE).getBoolean("active", false));
        call.resolve(r);
    }

    @PluginMethod
    public void recClear(PluginCall call) {
        try { RecService.logFile(getContext()).delete(); } catch (Exception ignore) {}
        call.resolve();
    }

    @PluginMethod
    public void takeQuick(PluginCall call) {
        JSObject r = new JSObject();
        try { r.put("items", new JSArray(QuickSave.take(getContext()))); } catch (Exception e) { r.put("items", new JSArray()); }
        r.put("action", action);
        action = null;
        call.resolve(r);
    }

    @PluginMethod
    public void setWidgetData(PluginCall call) {
        String json = call.getString("json", "{}");
        getContext().getSharedPreferences(MainWidget.PREFS, Context.MODE_PRIVATE).edit().putString("data", json).apply();
        MainWidget.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setVolumeKey(PluginCall call) {
        volumeKey = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        call.resolve(takeAll());
    }

    @PluginMethod
    public void batteryStatus(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok = true;
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                ok = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            }
        } catch (Exception e) {}
        r.put("ignoring", ok);
        r.put("maker", Build.MANUFACTURER);
        call.resolve(r);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            Intent it = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            it.setData(Uri.parse("package:" + getContext().getPackageName()));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(it);
        } catch (Exception e) {
            try {
                Intent it2 = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                it2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(it2);
            } catch (Exception e2) {}
        }
        call.resolve();
    }

    /** Condivisione file con tipo MIME esplicito (WhatsApp scarta i .gpx con tipo sconosciuto). */
    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            String uri = call.getString("uri", "");
            String mime = call.getString("mime", "application/octet-stream");
            String text = call.getString("text", "");
            String title = call.getString("title", "Footprint");
            String path = uri.startsWith("file://") ? Uri.parse(uri).getPath() : uri;
            Context ctx = getContext();
            Uri cu = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", new File(path));
            Intent it = new Intent(Intent.ACTION_SEND);
            it.setType(mime);
            it.putExtra(Intent.EXTRA_STREAM, cu);
            it.putExtra(Intent.EXTRA_SUBJECT, title);
            it.putExtra(Intent.EXTRA_TEXT, text);
            it.setClipData(ClipData.newRawUri(title, cu));
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent ch = Intent.createChooser(it, title);
            ch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(ch);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }
}
