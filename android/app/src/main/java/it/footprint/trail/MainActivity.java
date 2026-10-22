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
        if (getIntent() != null && getIntent().hasExtra("fp_action")) IntentFilesPlugin.action = getIntent().getStringExtra("fp_action");
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
        if (intent != null && intent.hasExtra("fp_action")) IntentFilesPlugin.action = intent.getStringExtra("fp_action");
        try {
            PluginHandle h = getBridge().getPlugin("IntentFiles");
            if (h != null) ((IntentFilesPlugin) h.getInstance()).deliver();
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('fpaction'))", null));
        } catch (Exception ignore) {
        }
    }
}
