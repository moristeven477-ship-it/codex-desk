package io.github.codexdesk.android;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import org.json.JSONArray;
import org.json.JSONObject;
import tailnet.Platform;

/** Uses Android's supported interface APIs instead of restricted Go netlink calls. */
final class AndroidNetwork implements Platform {
    private final ConnectivityManager connectivity;
    AndroidNetwork(Context context) { connectivity = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE); }
    @Override public String interfacesJSON() {
        JSONArray interfaces = new JSONArray();
        try {
            Enumeration<NetworkInterface> all = NetworkInterface.getNetworkInterfaces();
            while (all != null && all.hasMoreElements()) {
                NetworkInterface network = all.nextElement();
                try {
                    JSONObject entry = new JSONObject();
                    entry.put("Name", network.getName()); entry.put("Index", network.getIndex());
                    entry.put("MTU", Math.max(1280, network.getMTU()));
                    int flags = network.isUp() ? 1 : 0;
                    if (network.isLoopback()) flags |= 4;
                    if (network.isPointToPoint()) flags |= 8;
                    if (network.supportsMulticast()) flags |= 16;
                    entry.put("Flags", flags);
                    JSONArray addresses = new JSONArray();
                    for (InterfaceAddress address : network.getInterfaceAddresses()) {
                        String host = address.getAddress().getHostAddress();
                        if (host != null) addresses.put(host.split("%", 2)[0] + "/" + address.getNetworkPrefixLength());
                    }
                    entry.put("Addresses", addresses); interfaces.put(entry);
                } catch (Exception ignored) { /* A disappearing network is retried in the next snapshot. */ }
            }
        } catch (Exception ignored) { /* Offline devices can have no interfaces. */ }
        return interfaces.toString();
    }
    @Override public String defaultInterface() {
        LinkProperties properties = connectivity.getLinkProperties(connectivity.getActiveNetwork());
        return properties == null || properties.getInterfaceName() == null ? "" : properties.getInterfaceName();
    }
}
