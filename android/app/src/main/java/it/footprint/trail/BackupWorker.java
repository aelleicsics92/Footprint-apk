package it.footprint.trail;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Backup notturno senza aprire l'app: carica la coda preparata dall'app (outbox.json) su Supabase. */
public class BackupWorker extends Worker {
    static final String NAME = "fp-nightly-backup";

    public BackupWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    public static void schedule(Context c) {
        Calendar t = Calendar.getInstance();
        t.set(Calendar.HOUR_OF_DAY, 2); t.set(Calendar.MINUTE, 0); t.set(Calendar.SECOND, 0); t.set(Calendar.MILLISECOND, 0);
        if (t.getTimeInMillis() <= System.currentTimeMillis()) t.add(Calendar.DAY_OF_YEAR, 1);
        long delay = t.getTimeInMillis() - System.currentTimeMillis();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(BackupWorker.class, 24, TimeUnit.HOURS)
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }
    public static void cancel(Context c) { WorkManager.getInstance(c).cancelUniqueWork(NAME); }

    static String readAll(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toString("UTF-8");
        }
    }

    static int http(String method, String url, String key, String token, String ctype, String body, String[] extra, StringBuilder out) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(20000); c.setReadTimeout(60000);
        c.setRequestProperty("apikey", key);
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        if (ctype != null) c.setRequestProperty("Content-Type", ctype);
        if (extra != null) for (int i = 0; i + 1 < extra.length; i += 2) c.setRequestProperty(extra[i], extra[i + 1]);
        if (body != null) {
            c.setDoOutput(true);
            try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes("UTF-8")); }
        }
        int code = c.getResponseCode();
        if (out != null) {
            try (InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream()) {
                if (in != null) { ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) b.write(buf, 0, n); out.append(b.toString("UTF-8")); }
            }
        }
        c.disconnect();
        return code;
    }

    @NonNull @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        File f = new File(ctx.getFilesDir(), "outbox.json");
        if (!f.exists()) return Result.success();
        JSONArray ok = new JSONArray();
        JSONObject auth = null;
        boolean fail = false;
        try {
            JSONObject o = new JSONObject(readAll(f));
            String url = o.getString("url"), key = o.getString("key");
            auth = o.getJSONObject("auth");
            long now = System.currentTimeMillis() / 1000;
            if (auth.optLong("expires_at", 0) - 60 < now) {
                StringBuilder sb = new StringBuilder();
                int code = http("POST", url + "/auth/v1/token?grant_type=refresh_token", key, null, "application/json", "{\"refresh_token\":\"" + auth.getString("refresh_token") + "\"}", null, sb);
                if (code != 200) throw new Exception("refresh " + code);
                JSONObject j = new JSONObject(sb.toString());
                auth.put("access_token", j.getString("access_token"));
                auth.put("refresh_token", j.getString("refresh_token"));
                auth.put("expires_at", j.getLong("expires_at"));
            }
            String tok = auth.getString("access_token"), uid = auth.getString("uid");
            JSONArray photos = o.optJSONArray("photos");
            if (photos != null) for (int i = 0; i < photos.length(); i++) {
                JSONObject p = photos.getJSONObject(i);
                int code = http("POST", url + "/storage/v1/object/media/" + uid + "/" + p.getString("name"), key, tok, "text/plain", p.getString("text"), new String[]{"x-upsert", "true"}, null);
                if (code < 300) ok.put(new JSONObject().put("k", p.getString("k")).put("s", p.getString("s"))); else fail = true;
            }
            JSONArray rows = o.optJSONArray("rows");
            if (rows != null) {
                JSONArray batch = new JSONArray(); JSONArray meta = new JSONArray();
                for (int i = 0; i <= rows.length(); i++) {
                    boolean last = i == rows.length();
                    if (!last) {
                        JSONObject r = rows.getJSONObject(i);
                        JSONObject row = new JSONObject().put("kind", r.getString("kind")).put("item_id", r.getString("item_id")).put("data", r.get("data")).put("updated_at", new java.util.Date().toInstant().toString());
                        batch.put(row); meta.put(new JSONObject().put("k", r.getString("k")).put("s", r.getString("s")));
                    }
                    boolean isTrack = !last && "track".equals(rows.getJSONObject(i).getString("kind"));
                    if (batch.length() > 0 && (last || isTrack || batch.length() >= 20)) {
                        int code = http("POST", url + "/rest/v1/backups?on_conflict=user_id,kind,item_id", key, tok, "application/json", batch.toString(), new String[]{"Prefer", "resolution=merge-duplicates,return=minimal"}, null);
                        if (code < 300) for (int m = 0; m < meta.length(); m++) ok.put(meta.get(m)); else fail = true;
                        batch = new JSONArray(); meta = new JSONArray();
                    }
                }
            }
        } catch (Exception e) {
            fail = true;
        }
        try {
            JSONObject res = new JSONObject().put("ok", ok).put("t", System.currentTimeMillis());
            if (auth != null) res.put("auth", auth);
            try (FileOutputStream fo = new FileOutputStream(new File(ctx.getFilesDir(), "outbox-result.json"))) { fo.write(res.toString().getBytes("UTF-8")); }
        } catch (Exception ignore) {}
        if (!fail) f.delete();
        return fail ? Result.retry() : Result.success();
    }
}
