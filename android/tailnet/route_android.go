package tailnet

import "tailscale.com/net/netmon"

func updateDefaultRoute(name string) { netmon.UpdateLastKnownDefaultRouteInterface(name) }
