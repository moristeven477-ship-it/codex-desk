package tailnet

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
	"tailscale.com/tstest/integration"
	"tailscale.com/tstest/integration/testcontrol"
	"tailscale.com/types/logger"
)

func testCertificate(t *testing.T) (tls.Certificate, []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Ephemeral Codex Desk integration fixture"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, DNSNames: []string{"desk.tailtest.ts.net"}}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

// Opt in with DESK_ANDROID_EMBEDDED=1 and an isolated emulator. No production
// account, credentials, workspace, VPN daemon or CLI process is used.
func TestAndroidEmbeddedEndToEnd(t *testing.T) {
	if os.Getenv("DESK_ANDROID_EMBEDDED") != "1" {
		t.Skip("requires an Android emulator and SDK/NDK")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	sdk := os.Getenv("ANDROID_HOME")
	if sdk == "" {
		t.Fatal("ANDROID_HOME required")
	}
	serial := os.Getenv("ANDROID_SERIAL")
	if serial == "" {
		t.Fatal("ANDROID_SERIAL required; never choose a user's phone implicitly")
	}
	adb := filepath.Join(sdk, "platform-tools/adb")
	adbRun := func(args ...string) string {
		t.Helper()
		command := exec.CommandContext(ctx, adb, append([]string{"-s", serial}, args...)...)
		out, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("adb %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	if out := adbRun("shell", "pm", "list", "packages", "com.tailscale.ipn"); strings.Contains(out, "package:") {
		t.Fatal("test requires no external Tailscale app")
	}
	derpMap := integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1")
	coordinator := &testcontrol.Server{DERPMap: derpMap, MagicDNSDomain: "tailtest.ts.net", DNSConfig: &tailcfg.DNSConfig{Proxied: true}, AllNodesSameUser: true, Logf: logger.Discard}
	control := httptest.NewServer(coordinator)
	defer control.Close()
	reverse := func(port int) {
		value := fmt.Sprintf("tcp:%d", port)
		adbRun("reverse", value, value)
		t.Cleanup(func() { exec.Command(adb, "-s", serial, "reverse", "--remove", value).Run() })
	}
	reverse(control.Listener.Addr().(*net.TCPAddr).Port)
	for _, region := range derpMap.Regions {
		for _, node := range region.Nodes {
			reverse(node.DERPPort)
		}
	}
	desktop := &tsnet.Server{Dir: t.TempDir(), Hostname: "desk", ControlURL: control.URL, Logf: logger.Discard, UserLogf: logger.Discard}
	defer desktop.Close()
	if _, err := desktop.Up(ctx); err != nil {
		t.Fatal(err)
	}

	certificate, publicCA := testCertificate(t)

	caDir := filepath.Join(root, "android/app/build/embedded-res/raw")
	if err := os.MkdirAll(caDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(caDir, "embedded_test_ca.pem"), publicCA, 0600); err != nil {
		t.Fatal(err)
	}
	gradleArgs := []string{"-PembeddedTest", ":app:assembleIntegration", ":app:assembleIntegrationAndroidTest", "--no-daemon", "--max-workers=4"}
	if init := os.Getenv("DESK_GRADLE_INIT"); init != "" {
		gradleArgs = append(gradleArgs, "--init-script", init)
	}
	gradlePath := os.Getenv("DESK_GRADLE")
	if gradlePath == "" {
		gradlePath = filepath.Join(root, "android/gradlew")
	}
	gradle := exec.CommandContext(ctx, gradlePath, gradleArgs...)
	gradle.Dir = filepath.Join(root, "android")
	gradle.Stdout = os.Stdout
	gradle.Stderr = os.Stderr
	if err := gradle.Run(); err != nil {
		t.Fatal(err)
	}

	// A real RemoteGateway backed by the isolated CLI fixture serves the same UI.
	node := exec.CommandContext(ctx, "node", "--import", "tsx", "scripts/android-fixture.ts")
	node.Dir = root
	stdin, err := node.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := node.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	node.Stderr = os.Stderr
	if err := node.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { stdin.Close(); node.Wait() }()
	var gateway struct {
		Gateway string `json:"gateway"`
		Code    string `json:"code"`
	}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if line, ok := strings.CutPrefix(scanner.Text(), "ANDROID_FIXTURE="); ok {
			if err := json.Unmarshal([]byte(line), &gateway); err != nil {
				t.Fatal(err)
			}
			break
		}
	}
	if gateway.Gateway == "" {
		t.Fatal("remote gateway fixture did not start")
	}
	target, _ := url.Parse(gateway.Gateway)
	listener, err := desktop.Listen("tcp", ":8443")
	if err != nil {
		t.Fatal(err)
	}
	web := &http.Server{Handler: httputil.NewSingleHostReverseProxy(target)}
	go web.Serve(tls.NewListener(listener, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12}))
	defer web.Close()
	badCertificate, _ := testCertificate(t)
	badListener, err := desktop.Listen("tcp", ":8444")
	if err != nil {
		t.Fatal(err)
	}
	badWeb := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("untrusted certificate request reached server") })}
	go badWeb.Serve(tls.NewListener(badListener, &tls.Config{Certificates: []tls.Certificate{badCertificate}, MinVersion: tls.VersionTLS12}))
	defer badWeb.Close()

	adbRun("install", "-r", filepath.Join(root, "android/app/build/outputs/apk/integration/app-integration.apk"))
	adbRun("install", "-r", filepath.Join(root, "android/app/build/outputs/apk/androidTest/integration/app-integration-androidTest.apk"))
	adbRun("shell", "pm", "clear", "io.github.codexdesk.android.integration")
	for _, phase := range []string{"fresh", "resume"} {
		t.Logf("Android phase: %s", phase)
		out := adbRun("shell", "am", "instrument", "-w", "-r", "-e", "coordinator", control.URL, "-e", "pairingCode", gateway.Code, "-e", "phase", phase, "io.github.codexdesk.android.integration.test/androidx.test.runner.AndroidJUnitRunner")
		t.Log(out)
		if !strings.Contains(out, "OK (1 test)") || strings.Contains(out, "FAILURES") {
			t.Fatalf("Android %s failed", phase)
		}
		if phase == "fresh" {
			shot, err := exec.CommandContext(ctx, adb, "-s", serial, "exec-out", "run-as", "io.github.codexdesk.android.integration", "cat", "files/embedded-chat.png").Output()
			if err != nil {
				t.Fatal(err)
			}
			directory := filepath.Join(root, "test-results/android")
			os.MkdirAll(directory, 0755)
			if err := os.WriteFile(filepath.Join(directory, "embedded-chat.png"), shot, 0644); err != nil {
				t.Fatal(err)
			}
		}
		adbRun("shell", "am", "force-stop", "io.github.codexdesk.android.integration")
	}
	t.Log("PASS: embedded engine without external app; HTTPS pairing, WebSocket reply, network rebind, engine restart, Activity recreation, process restart, no duplicate sends, untrusted TLS rejection")
}
