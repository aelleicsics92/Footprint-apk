package it.footprint.trail;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IntentFilesPlugin.class);
        super.onCreate(savedInstanceState);
        IntentFilesPlugin.collect(this, getIntent());
        Intent in = getIntent();
        // niente replay dell'azione se l'activity viene ricreata dal sistema o riaperta dalla cronologia
        boolean replay = savedInstanceState != null || (in != null && (in.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0);
        if (in != null && in.hasExtra("fp_action")) {
            if (!replay) IntentFilesPlugin.action = in.getStringExtra("fp_action");
            in.removeExtra("fp_action");
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, android.view.KeyEvent event) {
        if (IntentFilesPlugin.volumeKey && keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (event.getRepeatCount() == 0 && getBridge() != null) {
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('hwvolume'))", null));
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        IntentFilesPlugin.collect(this, intent);
        if (intent != null && intent.hasExtra("fp_action")) { IntentFilesPlugin.action = intent.getStringExtra("fp_action"); intent.removeExtra("fp_action"); }
        try {
            PluginHandle h = getBridge().getPlugin("IntentFiles");
            if (h != null) ((IntentFilesPlugin) h.getInstance()).deliver();
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('fpaction'))", null));
        } catch (Exception ignore) {
        }
    }
}
