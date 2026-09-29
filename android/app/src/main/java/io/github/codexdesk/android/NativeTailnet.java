package io.github.codexdesk.android;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.json.JSONObject;
import tailnet.Client;
import tailnet.Tailnet;

/** The same embedded engine lives across Activity recreation; no external VPN app. */
final class NativeTailnet {
    interface Listener { void changed(State state); }
    static final class State {
        final String backend, authUrl, error;
        final int generation;
        State(String backend, String authUrl, String error, int generation) {
            this.backend = backend; this.authUrl = authUrl; this.error = error; this.generation = generation;
        }
        boolean ready() { return "Running".equals(backend); }
    }
    private static NativeTailnet instance;
    static synchronized NativeTailnet get(Context context) {
        if (instance == null) instance = new NativeTailnet(context.getApplicationContext(), new File(context.getNoBackupFilesDir(), "tailnet"), "");
        return instance;
    }
    // Only instrumentation inside a debug build can substitute its local coordinator.
    static synchronized void installTestInstance(Context context, File directory, String controlURL) {
        if (!BuildConfig.DEBUG || instance != null) throw new IllegalStateException("Test connection unavailable");
        instance = new NativeTailnet(context.getApplicationContext(), directory, controlURL);
    }
    private final AndroidNetwork platform;
    private final File directory;
    private final String coordinator;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Set<Listener> listeners = new CopyOnWriteArraySet<>();
    private Client client;
    private int generation;
    private volatile State state = new State("Starting", "", "", 0);
    private NativeTailnet(Context context, File directory, String coordinator) {
        this.directory = directory; this.coordinator = coordinator; platform = new AndroidNetwork(context);
        poll();
    }
    State state() { return state; }
    void listen(Listener listener) { listeners.add(listener); listener.changed(state); }
    void unlisten(Listener listener) { listeners.remove(listener); }
    private void notifyState(State next) {
        state = next;
        main.post(() -> { for (Listener listener : listeners) listener.changed(next); });
    }
    private void ensureStarted() throws Exception {
        if (client != null) return;
        Client pending = Tailnet.newClient(directory.getAbsolutePath(), platform, coordinator);
        try { pending.start(); client = pending; generation++; }
        catch (Exception error) { pending.close(); throw error; }
    }
    private void readState() throws Exception {
        ensureStarted();
        JSONObject json = new JSONObject(client.status());
        notifyState(new State(json.optString("state", "Starting"), json.optString("authUrl", ""), "", generation));
    }
    private void failed(Exception error) {
        String message = error.getMessage() == null ? "Connection unavailable" : error.getMessage();
        // Authorization URLs belong in the login action, never in diagnostic text.
        notifyState(new State("Error", "", message.replaceAll("https?://\\S+", "[link]"), generation));
    }
    private void poll() {
        worker.execute(() -> {
            try { readState(); } catch (Exception error) { failed(error); }
            main.postDelayed(this::poll, listeners.isEmpty() ? 15000 : 2000);
        });
    }
    void login() {
        worker.execute(() -> {
            try { ensureStarted(); client.login(); readState(); }
            catch (Exception error) { failed(error); }
        });
    }
    void retry() {
        notifyState(new State("Starting", "", "", generation));
        worker.execute(() -> {
            try { Client previous = client; client = null; if (previous != null) previous.close(); readState(); }
            catch (Exception error) { failed(error); }
        });
    }
    void networkChanged() {
        worker.execute(() -> {
            try { ensureStarted(); client.networkChanged(); readState(); }
            catch (Exception error) { failed(error); }
        });
    }
    void prepare(String origin, Consumer<String> ready, Consumer<Exception> failure) {
        worker.execute(() -> {
            try {
                ensureStarted(); client.setEndpoint(origin);
                String proxy = client.proxyAddress();
                main.post(() -> ready.accept(proxy));
            } catch (Exception error) { main.post(() -> failure.accept(error)); }
        });
    }
    void logout() {
        worker.execute(() -> {
            try { ensureStarted(); client.logout(); readState(); }
            catch (Exception error) { failed(error); }
        });
    }
}
