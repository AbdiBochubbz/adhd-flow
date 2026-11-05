package app.still.tasks;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StillNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
