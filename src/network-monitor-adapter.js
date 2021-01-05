/**
 * network-monitor.js - network presence scanner.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const ARPING_COUNT = 60 * 60 * 6; // seconds or ping count. ARPING sends one query per second

const manifest = require('../manifest.json');
const deviceSuffix = `-${manifest.id}`;

const {Adapter, Database} = require('gateway-addon');

const {NetworkMonitorDevice} = require('./network-monitor-device');
const os = require('os');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const {spawn} = require('child_process');
const IPCIDR = require('ip-cidr');

class NetworkMonitorAdapter extends Adapter {
  constructor(addonManager) {
    super(addonManager, 'NetworkMonitorAdapter', manifest.id);
    addonManager.addAdapter(this);

    // the devices that are added in the gateway, so actively track
    this.tracking = {};

    // the list of interfaces to scan (cidr notation)
    this.ifList = [];

    this.logging = false;
    this.ping_batch_size = 11;
    this.network_rescan_interval = 60;
    const db = new Database(manifest.id);
    db.open()
      .then(() => {
        return db.loadConfig();
      })
      .then((config) => {
        this.logging = config.logging || this.logging;
        this.ping_batch_size = config.ping_batch_size || this.ping_batch_size;
        this.network_rescan_interval = config.network_rescan_interval ||
          this.network_rescan_interval;
      })
      .then(() => {
      // find all networks supporting IPv4 that are not loopback or other internals
        const t = os.networkInterfaces();
        for (const i in t) {
          t[i].forEach((a) => {
            if (a.family === 'IPv4' && !a.internal) {
              this.ifList.push(new IPCIDR(a.cidr));
              this.logging && console.log('interface', a.cidr);
            }
          });
        }

        // periodically scan all devices on the network to find new devices
        this.scanNetwork();
        setInterval(() => this.scanNetwork(), this.network_rescan_interval * (60 * 1000));

        // send a frequent tick to the tracked 'devices' to update the times
        setInterval(() => {
          for (const d in this.tracking) {
            const device = this.findTracked(d);
            device && device.tick();
          }
        }
        // if the frequency is reduced here, then consider changing scanNetwork near 'hunting'
        // to add iterations of ping and arping.
        // Mobile devices deliberately ignore pings to either conserve battery or conserve privacy
        , 250);

        // periodically kick off a long-running job per tracked device to actively arping to see if
        // it is still present. This job should stay running for the whole period of ARPING_COUNT
        setInterval(() => {
          for (const d in this.tracking) {
            const device = this.findTracked(d);
            device && this.scanTracked(device);
          }
        }
        , (ARPING_COUNT - 1) * 1000);
      })
      .catch((e) => {
        console.error('error during startup:', e);
      });
  }

  // we may know about a required network device before we have its complete details - manage it
  findTracked(device) {
    if (typeof this.tracking[device] === 'string') {
      const newDevice = this.getDevice(device);
      if (newDevice) {
        this.tracking[device] = newDevice;
        // kick off the monitoring
        this.scanTracked(newDevice);
        return newDevice;
      }
      // keep hunting for the device
      this.scanNetwork(device);
      return null;
    }
    return this.tracking[device];
  }

  // scan the network using PING (ignoring the results), then use ARP to find the active addresses
  scanNetwork(trackedDevice) {
    const scan = [];

    if (!trackedDevice) {
      // scan groups of addresses in parallel, by creating a string with the ping commands
      this.ifList.forEach((i) => {
        const range_size = i.toArray().length;
        let s = '';
        let j = 0;
        i.loop((ip) => {
          // ignore the first and last addresses (except in tiny networks)
          if ((ip !== i.start() && ip !== i.end()) || range_size <= 4) {
            s = `${s}ping -c 1 ${ip};`;
            j++;
            if (j >= this.ping_batch_size) {
              s = `${s}exit 0`; // terminate nicely so failed pings do not show as an error
              scan.push(exec(s));
              s = '';
              j = 0;
            }
          }
        });
        // execute any last odd-sized chunk
        if (s !== '') {
          s = `${s}exit 0`;
          scan.push(exec(s));
        }
      });
    } else {
      // scan for a specific network device
      let device = trackedDevice;
      if (trackedDevice.endsWith(deviceSuffix)) {
        device = trackedDevice.substring(0, trackedDevice.indexOf(deviceSuffix));
      }
      this.logging && console.log('hunting', device);
      scan.push(exec(`ping -c 1 -4 ${device} ; exit 0`));
      scan.push(exec(`arping -c 1 ${device} ; exit 0`));
    }

    // process the results, which are stored in an array of promises
    scan.forEach((item) => item
      .then((result) => {
        if (result.error) {
          console.error('ping:', JSON.stringify(result.error));
        }
        if (result.stderr && result.stderr !== '') {
          throw new Error(`ping failed: ${result.stderr}`);
        }
      })
      .then(() => {
        return exec('arp|grep -v \'(incomplete)\'|grep -v HWtype ; exit 0');
      })
      .then((result) => {
        if (result.error) {
          console.error('arp:', JSON.stringify(result.error));
        }
        if (result.stderr && result.stderr !== '') {
          throw new Error(`arp failed: ${result.stderr}`);
        }
        return result.stdout;
      })
      .then((res) => {
        if (res && res.length > 0) {
          res = res.replace(/  +/g, ' ');
          for (const line of res.split('\n')) {
            if (line.length > 0) {
              const name = line.split('.')[0];
              const deviceId = name + deviceSuffix;
              const cols = line.split(' ');
              const mac = cols[2];
              const iface = cols[4];

              const device = this.getDevice(deviceId);

              if (!device) {
                this.handleDeviceAdded(new NetworkMonitorDevice(this, deviceId, name, mac, iface));
                this.findTracked(deviceId);
                this.logging && console.log('found', name);
              } else {
                device.mac = mac;
                device.iface = iface;
              }
            }
          }
        }
      })
      .catch((e) => console.error(e)));
  }

  // when informed of pairing, kick off a network scan to see if any new devices pop up
  startPairing() {
    this.scanNetwork();
  }

  // the gateway informs us of the devices the user is actively monitoring
  handleDeviceSaved(deviceId, device) {
    if (deviceId.endsWith(deviceSuffix)) {
      this.logging && console.log(`informed of ${device.title}`);
      if (!this.findTracked(deviceId)) {
        // store the indentifier until we can get the details
        this.tracking[deviceId] = deviceId;

        // and hunt for its details on the network
        this.scanNetwork(deviceId);
      }
    }
  }

  // use arping to find out of the device is still present on the network
  scanTracked(device) {
    // note that arping sends an arp request once a second,
    // so we asynchronously process the streamed results
    // a ping count of 3600 means the job runs for an hour
    const ping = spawn('arping', ['-c', ARPING_COUNT, '-i', device.iface, device.mac]);
    this.logging && console.log('tracking', device.title);
    ping.on('exit', (code) => this.logging &&
        console.log('arping completed for', device.title, ' with code ', code));
    ping.on('error', (err) => console.error('arping:', JSON.stringify(err)));

    ping.stdout.on('data', (data) => {
      // multiple lines may be delivered at once, process each separately
      const a = data.toString().split('\n');
      a.forEach((s) => {
        if (s.indexOf(' bytes ') !== -1) {
          // update the device details
          device.updateSeen();
          device.findProperty('address').set(s.split(' ')[3]);
          device.findProperty('present').set(true);
        }
      });
    });
    ping.stderr.on('data', (data) => console.error('arping:', data.toString()));
  }

}

module.exports = NetworkMonitorAdapter;
