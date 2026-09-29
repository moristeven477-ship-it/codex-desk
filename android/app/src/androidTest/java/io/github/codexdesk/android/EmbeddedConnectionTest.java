package io.github.codexdesk.android;

import android.content.Context;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Go engine, real WebView TLS, real gateway; only the CLI/account are fixtures. */
@RunWith(AndroidJUnit4.class)
public class EmbeddedConnectionTest {
    private ActivityScenario<MainActivity> activity;
    private static final String ORIGIN = "https://desk.tailtest.ts.net:8443";
    private static final String MESSAGE = "Hello through embedded Android Tailscale.";
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private static void eventually(String description, BooleanSupplier check) {
        long deadline = SystemClock.elapsedRealtime() + 60000;
        do { if (check.getAsBoolean()) return; SystemClock.sleep(200); } while (SystemClock.elapsedRealtime() < deadline);
        fail("Timed out: " + description);
    }
    private static <T extends View> T find(View view, Class<T> kind, String text) {
        if (kind.isInstance(view) && (text == null || view instanceof TextView && text.contentEquals(((TextView) view).getText()))) return kind.cast(view);
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            T found = find(((ViewGroup) view).getChildAt(i), kind, text); if (found != null) return found;
        }
        return null;
    }
    private void click(int label) {
        activity.onActivity(screen -> { Button button = find(screen.getWindow().getDecorView(), Button.class, screen.getString(label)); assertNotNull(button); assertTrue(button.isEnabled()); button.performClick(); });
    }
    private String js(String script) {
        AtomicReference<String> value = new AtomicReference<>("null"); CountDownLatch done = new CountDownLatch(1);
        activity.onActivity(screen -> {
            WebView browser = find(screen.getWindow().getDecorView(), WebView.class, null);
            if (browser == null) { done.countDown(); return; }
            browser.evaluateJavascript(script, result -> { value.set(result); done.countDown(); });
        });
        try { assertTrue("WebView callback", done.await(5, TimeUnit.SECONDS)); } catch (InterruptedException error) { throw new AssertionError(error); }
        return value.get();
    }
    private void page(String description, String condition) { eventually(description, () -> "true".equals(js(condition))); }
    private void connect(String origin) {
        eventually("native connected", () -> NativeTailnet.get(context()).state().ready());
        activity.onActivity(screen -> { EditText input = find(screen.getWindow().getDecorView(), EditText.class, null); assertNotNull(input); input.setText(origin); });
        click(R.string.connect);
    }
    @Test public void embeddedEngineCarriesDeskAndRecoversWithoutResending() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String coordinator = args.getString("coordinator");
        assertNotNull("Run with the local embedded test harness", coordinator);
        NativeTailnet.installTestInstance(context(), new File(context().getNoBackupFilesDir(), "test-tailnet"), coordinator);
        boolean resume = "resume".equals(args.getString("phase"));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            activity = scenario;
            if (!resume) {
                connect(ORIGIN);
                page("pairing page over embedded TLS", "!!document.querySelector('input[aria-label=\"Pairing code\"]')");
                String code = args.getString("pairingCode");
                assertTrue(code.matches("[A-Za-z0-9_-]+"));
                js("(()=>{const input=document.querySelector('input[aria-label=\"Pairing code\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'"+code+"');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
                page("pair button ready", "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Pair and connect'&&!b.disabled)");
                js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Pair and connect').click()");
                page("paired conversation", "!!document.querySelector('.composer textarea') && !document.querySelector('.remote-offline')");
                js("(()=>{const input=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'"+MESSAGE+"');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
                page("send enabled", "!!document.querySelector('.send-button:not(:disabled)')");
                js("document.querySelector('.send-button').click()");
            }
            String received = "document.body.innerText.includes('Your local Codex conversation is working.') && document.querySelectorAll('.user-text').length===1 && document.querySelector('.user-text').textContent==='"+MESSAGE+"' && !document.querySelector('.remote-offline')";
            page("one reply through encrypted tailnet", received);
            if (!resume) {
                page("turn completed", "!document.querySelector('.stop-button')");
                InstrumentationRegistry.getInstrumentation().waitForIdleSync();
                SystemClock.sleep(500); // Let the compositor present the verified reply for the screenshot.
                android.graphics.Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
                try (java.io.FileOutputStream output = new java.io.FileOutputStream(new File(context().getFilesDir(), "embedded-chat.png"))) {
                    assertTrue(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output));
                }
                screenshot.recycle();
            }
            activity.onActivity(screen -> NativeTailnet.get(screen).networkChanged());
            page("network rebind keeps history", received);
            int generation = NativeTailnet.get(context()).state().generation;
            activity.onActivity(screen -> NativeTailnet.get(screen).retry());
            eventually("engine restart reuses node state", () -> NativeTailnet.get(context()).state().ready() && NativeTailnet.get(context()).state().generation > generation);
            page("new proxy restores cookies, WebSocket and exactly one prompt", received);
            activity.recreate();
            page("Activity recreation restores conversation", received);
            if (resume) {
                click(R.string.connection_settings);
                connect("https://desk.tailtest.ts.net:8444");
                eventually("invalid certificate rejected", () -> {
                    AtomicReference<Boolean> shown = new AtomicReference<>(false);
                    activity.onActivity(screen -> shown.set(find(screen.getWindow().getDecorView(), TextView.class, screen.getString(R.string.certificate)) != null));
                    return shown.get();
                });
            }
        }
    }
}
