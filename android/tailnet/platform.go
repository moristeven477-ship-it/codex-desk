package tailnet

import (
	"encoding/json"
	"fmt"
	"net"
	"runtime"
	"sync"

	"tailscale.com/net/netmon"
)

// Platform provides Android's permitted network APIs. Android restricts the
// netlink calls used by Go's net.Interfaces on current target SDKs.
type Platform interface {
	InterfacesJSON() string
	DefaultInterface() string
}

var platformState struct {
	sync.RWMutex
	platform Platform
}
var registerPlatform sync.Once

func configurePlatform(platform Platform) {
	if runtime.GOOS != "android" || platform == nil {
		return
	}
	platformState.Lock()
	platformState.platform = platform
	platformState.Unlock()
	registerPlatform.Do(func() {
		netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
			platformState.RLock()
			p := platformState.platform
			platformState.RUnlock()
			return parseInterfaces(p.InterfacesJSON())
		})
	})
	updateDefaultRoute(platform.DefaultInterface())
}

func parseInterfaces(value string) ([]netmon.Interface, error) {
	var rows []struct {
		Name      string
		Index     int
		MTU       int
		Flags     uint
		Addresses []string
	}
	if err := json.Unmarshal([]byte(value), &rows); err != nil {
		return nil, fmt.Errorf("Android network interfaces: %w", err)
	}
	result := make([]netmon.Interface, 0, len(rows))
	for _, row := range rows {
		if row.Name == "" || row.Index <= 0 {
			continue
		}
		addresses := make([]net.Addr, 0, len(row.Addresses))
		for _, value := range row.Addresses {
			ip, network, err := net.ParseCIDR(value)
			if err != nil {
				continue
			}
			network.IP = ip
			addresses = append(addresses, network)
		}
		result = append(result, netmon.Interface{Interface: &net.Interface{Index: row.Index, Name: row.Name, MTU: row.MTU, Flags: net.Flags(row.Flags)}, AltAddrs: addresses})
	}
	return result, nil
}
