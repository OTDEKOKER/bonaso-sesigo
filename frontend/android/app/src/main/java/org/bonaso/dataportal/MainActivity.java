package org.bonaso.dataportal;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;
import java.io.IOException;
import java.util.HashMap;

public class MainActivity extends BridgeActivity {

    @Override
    public void onStart() {
        super.onStart();

        // SPA fallback: serve index.html for any route not found in the static
        // assets bundle, so client-side routing (React) handles navigation.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = super.shouldInterceptRequest(view, request);
                String path = request.getUrl().getPath();

                boolean isMissingAsset = (response == null || response.getStatusCode() == 404);
                boolean isNavigation = path != null
                    && !path.contains(".")            // no extension = page route
                    && !path.startsWith("/_next/")    // not a Next.js asset
                    && !path.startsWith("/api/");     // not an API call

                if (isMissingAsset && isNavigation) {
                    try {
                        InputStream stream = getApplicationContext()
                            .getAssets()
                            .open("public/index.html");
                        return new WebResourceResponse(
                            "text/html", "utf-8", 200, "OK",
                            new HashMap<>(), stream
                        );
                    } catch (IOException e) {
                        return response;
                    }
                }
                return response;
            }
        });
    }
}
