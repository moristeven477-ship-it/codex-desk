package io.github.codexdesk.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;

public class MainActivity extends Activity {
    private LinearLayout root;
    private FrameLayout content;
    private WebView browser;
    private LinearLayout failure;
    private TextView failureText;
    private NativeTailnet tailnet;
    private TextView tailnetStatus;
    private Button loginButton, logoutButton, connectButton;
    private boolean pendingLogin, resumeConnection, connecting, destroyed;
    private int connectionRevision, transportGeneration;
    private final NativeTailnet.Listener tailnetListener = this::tailnetChanged;
    private String origin;
    private ValueCallback<Uri[]> files;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private static final int FILE_REQUEST = 40;
    private static final int BG = Color.rgb(21, 23, 25);
    private static final int FG = Color.rgb(234, 238, 236);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets sizes = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(sizes.left, sizes.top, sizes.right, sizes.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
        }
        tailnet = NativeTailnet.get(this);
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { runOnUiThread(() -> { tailnet.networkChanged(); wake(); }); }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
        String saved = getPreferences(MODE_PRIVATE).getString("origin", "");
        try { origin = Endpoint.normalize(saved); resumeConnection = true; }
        catch (IllegalArgumentException ignored) { origin = null; }
        showConnection(false);
    }
    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextColor(FG); view.setTextSize(size);
        view.setPadding(0, dp(10), 0, dp(10)); return view;
    }
    private Button button(int label, View.OnClickListener click) {
        Button view = new Button(this); view.setText(label); view.setAllCaps(false); view.setOnClickListener(click); return view;
    }
    private void disposeBrowser() {
        if (files != null) { files.onReceiveValue(null); files = null; }
        if (browser != null) { browser.stopLoading(); browser.destroy(); browser = null; }
        CookieManager.getInstance().flush();
    }
    private void showConnection() { showConnection(true); }
    private void showConnection(boolean userInitiated) {
        if (userInitiated) resumeConnection = false;
        connectionRevision++; connecting = false;
        disposeBrowser(); root.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        LinearLayout column = new LinearLayout(this); column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(24), dp(40), dp(24), dp(24));
        ImageView icon = new ImageView(this); icon.setImageResource(R.drawable.sakura);
        column.addView(icon, new LinearLayout.LayoutParams(dp(76), dp(76)));
        column.addView(text("Codex Desk · Android", 16));
        column.addView(text(getString(R.string.heading), 28));
        column.addView(text(getString(R.string.intro), 16));
        column.addView(text(getString(R.string.step_tailscale), 19));
        column.addView(text(getString(R.string.tailscale_help), 15));
        tailnetStatus = text("", 15); tailnetStatus.setContentDescription(getString(R.string.network_status));
        column.addView(tailnetStatus);
        loginButton = button(R.string.sign_in, v -> loginTailnet());
        column.addView(loginButton);
        logoutButton = button(R.string.sign_out, v -> {
            pendingLogin = false; resumeConnection = false;
            CookieManager.getInstance().removeAllCookies(removed -> CookieManager.getInstance().flush());
            tailnet.logout();
        });
        column.addView(logoutButton);
        column.addView(text(getString(R.string.step_pair), 19));
        column.addView(text(getString(R.string.pair_help), 15));
        column.addView(text(getString(R.string.address), 14));
        EditText address = new EditText(this); address.setSingleLine(); address.setTextColor(FG); address.setHintTextColor(Color.GRAY);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint(R.string.address_hint); address.setText(getPreferences(MODE_PRIVATE).getString("origin", ""));
        address.setContentDescription(getString(R.string.address));
        column.addView(address, new LinearLayout.LayoutParams(-1, dp(56)));
        connectButton = button(R.string.connect, v -> {
            try { origin = Endpoint.normalize(address.getText().toString()); getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply(); connectToComputer(); }
            catch (IllegalArgumentException error) { address.setError(getString(R.string.invalid_address)); }
        });
        column.addView(connectButton);
        column.addView(button(R.string.licenses, v -> showLicenses()));
        scroll.addView(column); root.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
        tailnetChanged(tailnet.state());
    }
    private void tailnetChanged(NativeTailnet.State state) {
        if (destroyed) return;
        if (tailnetStatus != null) {
            int label = state.ready() ? R.string.network_ready : "NeedsLogin".equals(state.backend) ? R.string.network_login : "NeedsMachineAuth".equals(state.backend) ? R.string.network_approval : "Error".equals(state.backend) ? R.string.network_error : R.string.network_starting;
            tailnetStatus.setText(label);
            loginButton.setVisibility(state.ready() ? View.GONE : View.VISIBLE);
            loginButton.setText("NeedsMachineAuth".equals(state.backend) ? R.string.approve_device : "Error".equals(state.backend) ? R.string.retry : R.string.sign_in);
            logoutButton.setVisibility(state.ready() ? View.VISIBLE : View.GONE);
            connectButton.setEnabled(state.ready() && !connecting);
        }
        if (pendingLogin && Endpoint.isLoginURL(state.authUrl)) {
            pendingLogin = false; external(state.authUrl);
        }
        if (state.ready()) {
            pendingLogin = false;
            if (!connecting && origin != null && (resumeConnection || (browser != null && transportGeneration != state.generation))) {
                resumeConnection = false; connectToComputer();
            }
        }
    }
    private void loginTailnet() {
        NativeTailnet.State state = tailnet.state();
        if ("NeedsMachineAuth".equals(state.backend)) external("https://login.tailscale.com/admin/machines");
        else if (Endpoint.isLoginURL(state.authUrl)) external(state.authUrl);
        else if ("Error".equals(state.backend)) tailnet.retry();
        else { pendingLogin = true; tailnet.login(); }
    }
    private void connectToComputer() {
        if (origin == null || connecting) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            Toast.makeText(this, R.string.webview_update, Toast.LENGTH_LONG).show(); return;
        }
        connecting = true; if (connectButton != null) connectButton.setEnabled(false);
        int revision = ++connectionRevision;
        tailnet.prepare(origin, proxy -> {
            if (destroyed || revision != connectionRevision) return;
            if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
                try {
                    ProxyConfig config = new ProxyConfig.Builder().addProxyRule("http://" + proxy).removeImplicitRules().build();
                    ProxyController.getInstance().setProxyOverride(config, this::runOnUiThread, () -> {
                        if (destroyed || revision != connectionRevision) return;
                        transportGeneration = tailnet.state().generation; connecting = false; showBrowser();
                    });
                } catch (RuntimeException error) {
                    connecting = false; tailnetChanged(tailnet.state());
                    Toast.makeText(this, R.string.network_error, Toast.LENGTH_LONG).show();
                }
            } else { connecting = false; Toast.makeText(this, R.string.webview_update, Toast.LENGTH_LONG).show(); }
        }, error -> {
            if (destroyed || revision != connectionRevision) return;
            connecting = false; tailnetChanged(tailnet.state());
            Toast.makeText(this, R.string.network_error, Toast.LENGTH_LONG).show();
        });
    }
    private void showLicenses() {
        try (java.io.InputStream source = getAssets().open("TAILNET_NOTICES.txt")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int count;
            while ((count = source.read(buffer)) != -1) bytes.write(buffer, 0, count);
            ScrollView scroll = new ScrollView(this); TextView content = text(bytes.toString("UTF-8"), 12);
            content.setPadding(dp(16), dp(8), dp(16), dp(8)); content.setTextIsSelectable(true); scroll.addView(content);
            new AlertDialog.Builder(this).setTitle(R.string.licenses).setView(scroll).setPositiveButton(android.R.string.ok, null).show();
        } catch (java.io.IOException ignored) { Toast.makeText(this, R.string.network_error, Toast.LENGTH_SHORT).show(); }
    }
    @SuppressLint("SetJavaScriptEnabled")
    private void showBrowser() {
        disposeBrowser(); root.removeAllViews(); tailnetStatus = null; loginButton = null; logoutButton = null; connectButton = null;
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), 0, dp(6), 0);
        TextView host = text(Uri.parse(origin).getHost(), 12); host.setSingleLine(); host.setEllipsize(android.text.TextUtils.TruncateAt.END);
        toolbar.addView(host, new LinearLayout.LayoutParams(0, dp(40), 1));
        toolbar.addView(button(R.string.connection_settings, v -> showConnection()));
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(44)));
        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));
        content = new FrameLayout(this); root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        browser = new WebView(this); browser.setBackgroundColor(BG);
        WebSettings settings = browser.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " CodexDeskAndroid/" + BuildConfig.VERSION_NAME);
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true); settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (Endpoint.sameOrigin(origin, url)) {
                    if ("/_desk/connection".equals(request.getUrl().getPath())) {
                        if (request.isForMainFrame() && request.hasGesture()) showConnection();
                        return true;
                    }
                    return false;
                }
                if (request.isForMainFrame() && request.hasGesture()) external(url);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("data".equals(scheme) || "blob".equals(scheme) || Endpoint.sameOrigin(origin, request.getUrl().toString())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); fail(R.string.certificate); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) { if (request.isForMainFrame()) fail(R.string.offline); }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (view != browser || !Endpoint.sameOrigin(origin, url)) return;
                // Older servers retain the native connection button. The new
                // mobile shell exposes it in its menu and pairing screen.
                view.evaluateJavascript("Boolean(document.querySelector('meta[name=\"codex-desk-mobile-shell\"][content=\"1\"]'))", supported -> {
                    if (view == browser) toolbar.setVisibility("true".equals(supported) ? View.GONE : View.VISIBLE);
                });
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsPrompt(WebView view, String url, String message, String value, JsPromptResult result) {
                if (!Endpoint.sameOrigin(origin, url)) { result.cancel(); return true; }
                EditText input = new EditText(MainActivity.this); input.setSingleLine(); input.setText(value);
                new AlertDialog.Builder(MainActivity.this).setTitle("Codex Desk").setMessage(message).setView(input)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm(input.getText().toString()))
                    .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (!Endpoint.sameOrigin(origin, url)) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setTitle("Codex Desk").setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); progress.setVisibility(value < 100 ? View.VISIBLE : View.GONE); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (files != null) files.onReceiveValue(null);
                files = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(Intent.createChooser(pick, getString(R.string.select_images)), FILE_REQUEST); }
                catch (ActivityNotFoundException error) { files.onReceiveValue(null); files = null; }
                return true;
            }
        });
        content.addView(browser, new FrameLayout.LayoutParams(-1, -1));
        failure = new LinearLayout(this); failure.setOrientation(LinearLayout.VERTICAL); failure.setGravity(Gravity.CENTER); failure.setPadding(dp(24), dp(24), dp(24), dp(24)); failure.setBackgroundColor(BG);
        failureText = text("", 17); failureText.setGravity(Gravity.CENTER); failure.addView(failureText);
        failure.addView(button(R.string.retry, v -> { if (tailnet.state().ready()) connectToComputer(); else { showConnection(); tailnet.retry(); } }));
        failure.addView(button(R.string.connection_settings, v -> showConnection()));
        failure.setVisibility(View.GONE); content.addView(failure, new FrameLayout.LayoutParams(-1, -1));
        browser.loadUrl(origin + "/");
    }
    private void fail(int message) { if (failure != null) { failureText.setText(message); failure.setVisibility(View.VISIBLE); } }
    private void external(String value) {
        Uri uri = Uri.parse(value);
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException ignored) { Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show(); }
    }
    private void wake() {
        if (browser == null) return;
        if (failure != null && failure.getVisibility() == View.VISIBLE) { failure.setVisibility(View.GONE); browser.reload(); }
        else browser.evaluateJavascript("window.dispatchEvent(new Event('online'))", null);
    }
    private void navigateBack() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsets insets = root.getRootWindowInsets();
            if (insets != null && insets.isVisible(WindowInsets.Type.ime())) {
                android.view.WindowInsetsController controller = root.getWindowInsetsController();
                if (controller != null) controller.hide(WindowInsets.Type.ime());
                return;
            }
        }
        if (browser == null) { moveTaskToBack(true); return; }
        WebView current = browser;
        current.evaluateJavascript("!document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}))", handled -> {
            if (current == browser && !"true".equals(handled)) moveTaskToBack(true);
        });
    }
    // API 26–32 fallback; API 33+ uses OnBackInvokedDispatcher above.
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { navigateBack(); }
    @Override protected void onStart() { super.onStart(); tailnet.listen(tailnetListener); }
    @Override protected void onStop() { tailnet.unlisten(tailnetListener); super.onStop(); }
    @Override protected void onResume() { super.onResume(); tailnet.networkChanged(); wake(); }
    @Override protected void onPause() { CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != FILE_REQUEST || files == null) return;
        ArrayList<Uri> selected = new ArrayList<>();
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) selected.add(data.getClipData().getItemAt(i).getUri());
            else if (data.getData() != null) selected.add(data.getData());
        }
        selected.removeIf(uri -> !"content".equals(uri.getScheme()) || getContentResolver().getType(uri) == null || !getContentResolver().getType(uri).startsWith("image/"));
        if (selected.size() > 8) { selected.clear(); Toast.makeText(this, R.string.image_limit, Toast.LENGTH_SHORT).show(); }
        files.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0])); files = null;
    }
    @Override protected void onDestroy() {
        destroyed = true; connectionRevision++; tailnet.unlisten(tailnetListener);
        connectivity.unregisterNetworkCallback(networkCallback); disposeBrowser(); super.onDestroy();
    }
}
