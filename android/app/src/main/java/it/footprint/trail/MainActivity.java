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
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        IntentFilesPlugin.collect(this, intent);
        try {
            PluginHandle h = getBridge().getPlugin("IntentFiles");
            if (h != null) ((IntentFilesPlugin) h.getInstance()).deliver();
        } catch (Exception ignore) {
        }
    }
}
