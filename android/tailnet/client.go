// Package tailnet embeds the official Tailscale userspace engine in Codex Desk.
// gomobile binds this package into the APK; no second app or system VPN is used.
package tailnet

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/envknob"
	"tailscale.com/tsnet"
)

const EngineVersion = "1.102.4"

// Client owns an app-private node and a restricted loopback CONNECT transport.
type Client struct {
	server   *tsnet.Server
	platform Platform
	mu       sync.Mutex
	proxy    *tunnelProxy
	local    *local.Client
	closed   bool
}

// NewClient creates a persistent embedded node. Production passes an empty
// controlURL (official Tailscale). A loopback test coordinator is accepted for
// emulator integration tests; no credentials are built into either APK.
func NewClient(directory string, platform Platform, controlURL string) (*Client, error) {
	if !filepath.IsAbs(directory) {
		return nil, errors.New("state directory must be absolute")
	}
	if controlURL == "" {
		controlURL = "https://controlplane.tailscale.com"
	}
	u, err := url.Parse(controlURL)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid coordinator")
	}
	loopback := net.ParseIP(u.Hostname())
	if controlURL != "https://controlplane.tailscale.com" && !(u.Scheme == "http" && loopback != nil && loopback.IsLoopback()) {
		return nil, errors.New("unsupported coordinator")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	if err := os.Chmod(directory, 0700); err != nil {
		return nil, err
	}
	configurePlatform(platform)
	// Official opt-out: do not upload embedded-engine diagnostic logs.
	envknob.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	// Android has no writable Unix home/cache directory. Upstream log policy
	// still resolves a local state directory even when uploads are disabled.
	envknob.Setenv("TS_LOGS_DIR", directory)
	s := &tsnet.Server{Dir: directory, Hostname: "codex-desk-android", ControlURL: controlURL,
		UserLogf: func(string, ...any) {}, Logf: func(string, ...any) {}}
	return &Client{server: s, platform: platform}, nil
}

func (c *Client) Start() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("connection closed")
	}
	if c.local != nil {
		return nil
	}
	lc, err := c.server.LocalClient()
	if err != nil {
		return err
	}
	proxy, err := newTunnelProxy(c.server.Dial)
	if err != nil {
		return err
	}
	c.local, c.proxy = lc, proxy
	return nil
}

func (c *Client) localClient() (*local.Client, error) {
	if err := c.Start(); err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, errors.New("connection closed")
	}
	return c.local, nil
}

// Status returns only the fields needed by the native onboarding UI.
func (c *Client) Status() (string, error) {
	lc, err := c.localClient()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	status, err := lc.StatusWithoutPeers(ctx)
	if err != nil {
		return "", err
	}
	result := struct {
		State   string `json:"state"`
		AuthURL string `json:"authUrl"`
		Version string `json:"version"`
	}{
		State: status.BackendState, AuthURL: status.AuthURL, Version: EngineVersion,
	}
	data, err := json.Marshal(result)
	return string(data), err
}

func (c *Client) Login() error {
	lc, err := c.localClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return lc.StartLoginInteractive(ctx)
}

func (c *Client) SetEndpoint(origin string) error {
	if err := c.Start(); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("connection closed")
	}
	return c.proxy.setEndpoint(origin)
}

func (c *Client) ProxyAddress() (string, error) {
	if err := c.Start(); err != nil {
		return "", err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return "", errors.New("connection closed")
	}
	return c.proxy.listener.Addr().String(), nil
}

func (c *Client) NetworkChanged() error {
	if c.platform != nil {
		updateDefaultRoute(c.platform.DefaultInterface())
	}
	lc, err := c.localClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return lc.DebugAction(ctx, "rebind")
}

func (c *Client) Logout() error {
	lc, err := c.localClient()
	if err != nil {
		return err
	}
	if err := c.SetEndpoint(""); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return lc.Logout(ctx)
}

func (c *Client) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	proxy := c.proxy
	c.mu.Unlock()
	if proxy != nil {
		proxy.close()
	}
	return c.server.Close()
}
