package tailnet

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var tailHostname = regexp.MustCompile(`^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$`)

func endpointAddress(origin string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || !tailHostname.MatchString(strings.ToLower(u.Hostname())) {
		return "", errors.New("enter the HTTPS address from desktop Phone access")
	}
	port := u.Port()
	if port == "" {
		port = "443"
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", errors.New("invalid connection port")
	}
	return net.JoinHostPort(strings.ToLower(u.Hostname()), strconv.Itoa(n)), nil
}

type tunnelProxy struct {
	mu         sync.Mutex
	endpoint   string
	closed     bool
	generation uint64
	conns      map[net.Conn]struct{}
	slots      chan struct{}
	dial       func(context.Context, string, string) (net.Conn, error)
	server     *http.Server
	listener   net.Listener
}

func newTunnelProxy(dial func(context.Context, string, string) (net.Conn, error)) (*tunnelProxy, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &tunnelProxy{dial: dial, conns: make(map[net.Conn]struct{}), slots: make(chan struct{}, 32), listener: listener}
	p.server = &http.Server{Handler: p, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	go p.server.Serve(listener)
	return p, nil
}

func (p *tunnelProxy) setEndpoint(origin string) error {
	endpoint := ""
	var err error
	if origin != "" {
		endpoint, err = endpointAddress(origin)
		if err != nil {
			return err
		}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("connection closed")
	}
	if endpoint != p.endpoint {
		p.generation++
		p.endpoint = endpoint
		for conn := range p.conns {
			conn.Close()
		}
	}
	return nil
}

func (p *tunnelProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	endpoint, generation, closed := p.endpoint, p.generation, p.closed
	p.mu.Unlock()
	if closed || endpoint == "" {
		http.Error(w, "Connect to a computer first", http.StatusServiceUnavailable)
		return
	}
	// Only an HTTPS tunnel to the selected Desk endpoint is allowed. There is no
	// general tailnet proxy, plaintext forwarding, or fallback to ordinary DNS.
	if r.Method != http.MethodConnect || strings.ToLower(r.Host) != endpoint || r.URL.Host != r.Host || r.ContentLength > 0 {
		http.Error(w, "Destination not allowed", http.StatusForbidden)
		return
	}
	select {
	case p.slots <- struct{}{}:
		defer func() { <-p.slots }()
	default:
		http.Error(w, "Too many connections", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	upstream, err := p.dial(ctx, "tcp", endpoint)
	if err != nil {
		http.Error(w, "Computer unavailable", http.StatusBadGateway)
		return
	}
	defer upstream.Close()
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "Tunnel unavailable", http.StatusInternalServerError)
		return
	}
	p.mu.Lock()
	if p.closed || p.generation != generation {
		p.mu.Unlock()
		http.Error(w, "Connection changed", http.StatusServiceUnavailable)
		return
	}
	downstream, rw, err := hj.Hijack()
	if err != nil {
		p.mu.Unlock()
		return
	}
	p.conns[downstream] = struct{}{}
	p.conns[upstream] = struct{}{}
	p.mu.Unlock()
	defer func() {
		downstream.Close()
		p.mu.Lock()
		delete(p.conns, downstream)
		delete(p.conns, upstream)
		p.mu.Unlock()
	}()
	downstream.SetDeadline(time.Time{})
	if _, err = rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	if err = rw.Flush(); err != nil {
		return
	}
	finished := make(chan struct{})
	go func() { io.Copy(upstream, rw); upstream.Close(); downstream.Close(); close(finished) }()
	io.Copy(downstream, upstream)
	downstream.Close()
	upstream.Close()
	<-finished
}

func (p *tunnelProxy) close() error {
	p.mu.Lock()
	p.closed = true
	p.generation++
	for conn := range p.conns {
		conn.Close()
	}
	p.mu.Unlock()
	return p.server.Close()
}
