package tailnet

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestEndpointRestriction(t *testing.T) {
	for _, value := range []string{"http://desk.test.ts.net", "https://evil.com", "https://desk.test.ts.net.evil.com", "https://user@desk.test.ts.net", "https://desk.test.ts.net/path", "https://desk.test.ts.net?q=x", "https://desk.test.ts.net#x", "https://desk.test.ts.net:0", "https://desk.test.ts.net:65536"} {
		if _, err := endpointAddress(value); err == nil {
			t.Errorf("accepted %q", value)
		}
	}
	if got, err := endpointAddress("https://Desk.Test.ts.net:8443/"); err != nil || got != "desk.test.ts.net:8443" {
		t.Fatalf("normalization: %q %v", got, err)
	}
}

func TestProxyRejectsOtherDestinationsBeforeDial(t *testing.T) {
	var calls atomic.Int32
	p, err := newTunnelProxy(func(context.Context, string, string) (net.Conn, error) {
		calls.Add(1)
		return nil, fmt.Errorf("must not dial")
	})
	if err != nil {
		t.Fatal(err)
	}
	defer p.close()
	if !p.listener.Addr().(*net.TCPAddr).IP.IsLoopback() {
		t.Fatal("proxy exposed outside loopback")
	}
	p.setEndpoint("https://desk.test.ts.net:8443")
	for _, request := range []string{
		"GET http://desk.test.ts.net:8443/ HTTP/1.1\r\nHost: desk.test.ts.net:8443\r\n\r\n",
		"CONNECT other.test.ts.net:8443 HTTP/1.1\r\nHost: other.test.ts.net:8443\r\n\r\n",
		"CONNECT desk.test.ts.net:443 HTTP/1.1\r\nHost: desk.test.ts.net:443\r\n\r\n",
		"CONNECT desk.test.ts.net:8443 HTTP/1.1\r\nHost: desk.test.ts.net:8443\r\nContent-Length: 1\r\n\r\nx",
	} {
		conn, err := net.Dial("tcp", p.listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		conn.SetDeadline(time.Now().Add(time.Second))
		io.WriteString(conn, request)
		response, err := http.ReadResponse(bufio.NewReader(conn), nil)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 403 {
			t.Errorf("status %d", response.StatusCode)
		}
		response.Body.Close()
		conn.Close()
	}
	if calls.Load() != 0 {
		t.Fatal("disallowed request reached tailnet")
	}
}

func TestHTTPSValidationRemainsEndToEnd(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("encrypted desk response")) }))
	defer server.Close()
	p, err := newTunnelProxy(func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "desk.test.ts.net:8443" {
			t.Errorf("unexpected target: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	defer p.close()
	p.setEndpoint("https://desk.test.ts.net:8443")
	proxy, _ := url.Parse("http://" + p.listener.Addr().String())
	transport := &http.Transport{Proxy: http.ProxyURL(proxy)}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	if response, err := client.Get("https://desk.test.ts.net:8443"); err == nil {
		response.Body.Close()
		t.Fatal("untrusted TLS certificate was accepted")
	}
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	transport.TLSClientConfig = &tls.Config{RootCAs: roots, ServerName: "example.com"}
	response, err := client.Get("https://desk.test.ts.net:8443")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil || string(data) != "encrypted desk response" {
		t.Fatalf("response %q: %v", data, err)
	}
}

func TestEndpointChangeClosesActiveTunnels(t *testing.T) {
	echo, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	go func() {
		conn, err := echo.Accept()
		if err == nil {
			defer conn.Close()
			io.Copy(conn, conn)
		}
	}()
	p, err := newTunnelProxy(func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, echo.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	defer p.close()
	p.setEndpoint("https://desk.test.ts.net:8443")
	conn, err := net.Dial("tcp", p.listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	// TLS/WebSocket bytes can already be buffered behind CONNECT.
	io.WriteString(conn, "CONNECT desk.test.ts.net:8443 HTTP/1.1\r\nHost: desk.test.ts.net:8443\r\n\r\nhello")
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, nil)
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("CONNECT: %v %v", response, err)
	}
	bytes := make([]byte, 5)
	if _, err := io.ReadFull(reader, bytes); err != nil || string(bytes) != "hello" {
		t.Fatalf("tunnel lost buffered data: %q %v", bytes, err)
	}
	if err := p.setEndpoint("https://evil.com"); err == nil {
		t.Fatal("invalid endpoint accepted")
	}
	io.WriteString(conn, "again")
	if _, err := io.ReadFull(reader, bytes); err != nil || string(bytes) != "again" {
		t.Fatal("invalid endpoint disrupted valid connection")
	}
	p.setEndpoint("https://second.test.ts.net:8443")
	if _, err := reader.ReadByte(); err == nil {
		t.Fatal("old tunnel survived computer change")
	}
}

func TestAndroidInterfaceAddresses(t *testing.T) {
	interfaces, err := parseInterfaces(`[{"Name":"wlan0","Index":4,"MTU":1500,"Flags":17,"Addresses":["192.0.2.4/24","2001:db8::8/64","invalid"]},{"Name":"gone","Index":0}]`)
	if err != nil || len(interfaces) != 1 {
		t.Fatalf("interfaces: %v %v", interfaces, err)
	}
	addresses, err := interfaces[0].Addrs()
	if err != nil || len(addresses) != 2 || addresses[0].String() != "192.0.2.4/24" || !strings.Contains(addresses[1].String(), "::8/64") {
		t.Fatalf("lost host address: %v %v", addresses, err)
	}
}
