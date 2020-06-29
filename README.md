# network-monitor

An experimental adapter to track network presence.
A production quality alternative is https://github.com/flatsiedatsie/webthings-network-presence-detection

Network Monitor
- runs on Linux only and possibly only on Debian derived disributions - patches are welcome
- is aware of multiple IPv4 networks and can monitor devices on each
- tracks seconds, minutes, hours and days since a device was last detected
- can change the units of preesenc expiry between seconds, miuntes, hours and days
- is a playground for me to explore ideas

Installation pre-requisites
- install arping and grant CAP_NET_RAW to arping
`sudo apt install arping
`sudo setcap cap_net_raw+eip $(eval readlink -f `which arping`)
