package it.footprint.trail;

import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.widget.Toast;

public class WpTileService extends TileService {
    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t != null) { t.setState(Tile.STATE_INACTIVE); t.updateTile(); }
    }

    @Override
    public void onClick() {
        Toast.makeText(this, QuickSave.save(this, "wp"), Toast.LENGTH_LONG).show();
    }
}
