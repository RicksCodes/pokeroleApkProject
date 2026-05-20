package com.pokeroleprofilemanager.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.os.Handler;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {

    private boolean backPressedOnce = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveMode();
    }

    private void applyImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }

    public void onBackPressed() {
        getBridge().getWebView().evaluateJavascript(
            "localStorage.getItem('currentPage')",
            value -> {
                if (value != null && value.contains("trainer")) {
                    getBridge().triggerWindowJSEvent("backButton");
                } else {
                    if (backPressedOnce) {
                        finishAffinity();
                    } else {
                        backPressedOnce = true;
                        getBridge().triggerWindowJSEvent("backButton");
                        new Handler().postDelayed(() -> backPressedOnce = false, 2000);
                    }
                }
            }
        );
    }
}