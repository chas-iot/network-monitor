# network-monitor

An experimental adapter to track network presence.
A production quality alternative is https://github.com/flatsiedatsie/webthings-network-presence-detection

Network Monitor
- runs on Linux only and possibly only on Debian derived disributions - patches are welcome
- is aware of multiple IPv4 networks and can monitor devices on each
- tracks seconds, minutes, hours and days since a device was last detected
- can change the units of presence expiry between seconds, miuntes, hours and days
- is a playground for me to explore ideas

Installation pre-requisites
- install arping
`sudo apt install arping`

- add a line similar to the following into sudoers - check both the user id that runs the adaptor and the path to the arping executable
`webthings       ALL= NOPASSWD: /usr/sbin/arping`
