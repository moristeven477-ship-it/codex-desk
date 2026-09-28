package io.github.codexdesk.android;
import org.junit.Test;
import static org.junit.Assert.*;
public class EndpointTest {
    @Test public void tailscaleNamesRemainIndependentOfPhoneIp() {
        assertEquals("https://computer.tailabc.ts.net:8443", Endpoint.normalize(" computer.tailabc.ts.net:8443/ "));
        assertTrue(Endpoint.sameOrigin("https://computer.tailabc.ts.net:8443", "https://computer.tailabc.ts.net:8443/assets/app.js"));
        assertFalse(Endpoint.sameOrigin("https://computer.tailabc.ts.net:8443", "https://computer.tailabc.ts.net:443/"));
    }
    @Test public void rejectsUnsafeOrAmbiguousAddresses() {
        String[] invalid = { "", "http://computer.tailabc.ts.net", "https://computer.tailabc.ts.net.evil.test", "https://user@computer.tailabc.ts.net", "https://computer.tailabc.ts.net/#secret", "https://computer.tailabc.ts.net/login", "https://computer.tailabc.ts.net/?token=x", "file:///etc/passwd", "https://100.64.0.1", "https://computer.tailabc.ts.net:0" };
        for (String value : invalid) assertThrows(value, IllegalArgumentException.class, () -> Endpoint.normalize(value));
    }
}
