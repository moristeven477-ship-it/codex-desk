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
import java.io.ByteArrayInputStream;
import java.util.ArrayList;

public class MainActivity extends Activity {
    private LinearLayout root;
    private FrameLayout content;
    private WebView browser;
    private LinearLayout failure;
    private TextView failureText;
    private Button tailscaleButton;
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
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { runOnUiThread(() -> wake()); }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
        String saved = getPreferences(MODE_PRIVATE).getString("origin", "");
        try { origin = Endpoint.normalize(saved); showBrowser(); }
        catch (IllegalArgumentException ignored) { showConnection(); }
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
    private void showConnection() {
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
        tailscaleButton = button(R.string.tailscale, v -> openTailscale());
        column.addView(tailscaleButton);
        updateTailscaleButton();
        column.addView(text(getString(R.string.step_pair), 19));
        column.addView(text(getString(R.string.pair_help), 15));
        column.addView(text(getString(R.string.address), 14));
        EditText address = new EditText(this); address.setSingleLine(); address.setTextColor(FG); address.setHintTextColor(Color.GRAY);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint(R.string.address_hint); address.setText(getPreferences(MODE_PRIVATE).getString("origin", ""));
        address.setContentDescription(getString(R.string.address));
        column.addView(address, new LinearLayout.LayoutParams(-1, dp(56)));
        column.addView(button(R.string.connect, v -> {
            try { origin = Endpoint.normalize(address.getText().toString()); getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply(); showBrowser(); }
            catch (IllegalArgumentException error) { address.setError(getString(R.string.invalid_address)); }
        }));
        scroll.addView(column); root.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
    }
    private void updateTailscaleButton() {
        if (tailscaleButton != null) tailscaleButton.setText(getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn") == null ? R.string.install_tailscale : R.string.open_tailscale);
    }
    private void openTailscale() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
        if (launch != null) {
            try { startActivity(launch); return; } catch (ActivityNotFoundException ignored) { }
        }
        external("https://tailscale.com/download/android");
    }
    @SuppressLint("SetJavaScriptEnabled")
    private void showBrowser() {
        disposeBrowser(); root.removeAllViews(); tailscaleButton = null;
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
                if (Endpoint.sameOrigin(origin, url)) return false;
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
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); }
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
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); progress.setVisibility(value < 100 ? View.VISIBLE : View.INVISIBLE); }
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
        failure.addView(button(R.string.retry, v -> { failure.setVisibility(View.GONE); browser.reload(); }));
        failure.addView(button(R.string.open_tailscale, v -> openTailscale()));
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
    @Override protected void onResume() { super.onResume(); updateTailscaleButton(); wake(); }
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
        connectivity.unregisterNetworkCallback(networkCallback); disposeBrowser(); super.onDestroy();
    }
}
