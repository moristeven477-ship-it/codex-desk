package io.github.codexdesk.android;

import java.net.URI;
import java.util.Locale;

/** Only authenticated HTTPS origins served inside a Tailscale network. */
public final class Endpoint {
    private Endpoint() {}
    public static boolean isLoginURL(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && "login.tailscale.com".equals(uri.getHost()) && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception ignored) { return false; }
    }
    public static String normalize(String input) {
        try {
            String value = input.trim();
            if (!value.contains("://")) value = "https://" + value;
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null ||
                !host.toLowerCase(Locale.ROOT).matches("[a-z0-9-]+\\.[a-z0-9-]+\\.ts\\.net") ||
                uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
                (!uri.getPath().isEmpty() && !uri.getPath().equals("/")) ||
                uri.getPort() == 0 || uri.getPort() > 65535 || uri.getPort() < -1) {
                throw new IllegalArgumentException("Invalid Tailscale HTTPS address");
            }
            return "https://" + host.toLowerCase(Locale.ROOT) +
                (uri.getPort() == -1 || uri.getPort() == 443 ? "" : ":" + uri.getPort());
        } catch (Exception error) { throw new IllegalArgumentException("Invalid Tailscale HTTPS address", error); }
    }
    public static boolean sameOrigin(String origin, String value) {
        try {
            URI uri = new URI(value);
            String candidate = new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString();
            return uri.getUserInfo() == null && normalize(origin).equals(normalize(candidate));
        } catch (Exception ignored) { return false; }
    }
}
