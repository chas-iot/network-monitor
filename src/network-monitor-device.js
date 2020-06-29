/**
 * network-monitor-device.js - network scanner.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const {
    Device,
    Property,
} = require('gateway-addon');

class NetworkMonitorProperty extends Property {
  constructor(device, name, propertyDescription) {
    super(device, name, propertyDescription);
    if (propertyDescription.value) {
        this.setCachedValueAndNotify(propertyDescription.value);
    }
  }

  get() {
      return this.value;
  }

  set(newValue) {
      this.setCachedValueAndNotify(newValue);
  }
}

class UnitsNetworkMonitorProperty extends NetworkMonitorProperty {
    constructor(device, name, propertyDescription) {
        super(device, name, propertyDescription);
        this.lookups = {
            seconds: {
                factor: 1,
                default: 600,   // 600 seconds = 10 minute
            },
            minutes: {
                factor: 60,
                default: 10,    // 10 minutes
            },
            hours: {
                factor: 60*60,
                default: 1,
            },
            days: {
                factor: 60*60*24,
                default: 1,
            },
        };
    }

    setCachedValueAndNotify(newValue) {
        const t = super.setCachedValueAndNotify(newValue);
        this.device.onGranularityChange(newValue);
        return t;
    }

}

  class NetworkMonitorDevice extends Device {
    constructor(adapter, id, title, mac, iface) {
        super(adapter, id);
        this.title = title;
        this.description = 'Network Presence of ' + title;
        this['@type'] = ['BinarySensor'];
        this.mac = mac;
        this.iface = iface;

        this.lastSeen = -1;
        this.factor = 1;

        this.properties.set('present',
            new NetworkMonitorProperty(this, 'present', {
                title: 'Present',
                description: 'The address is responding',
                '@type': 'BooleanProperty',
                type: 'boolean',
                value: false,
                readOnly: true,
            })
        );

        this.properties.set('seconds',
            new NetworkMonitorProperty(this, 'seconds', {
                title: 'Seconds since last seen',
                description: 'The number of seconds since the device was last contactable on the network',
                type: 'integer',
                unit: 'seconds',
                readOnly: true,
                value: -1,
            })
        );

        this.properties.set('minutes',
            new NetworkMonitorProperty(this, 'minutes', {
                title: 'Minutes since last seen',
                description: 'The number of minutes since the device was last contactable on the network',
                type: 'integer',
                unit: 'minutes',
                readOnly: true,
                value: -1,
            })
        );

        this.properties.set('hours',
            new NetworkMonitorProperty(this, 'hours', {
                title: 'Hours since last seen',
                description: 'The number of minutes since the device was last contactable on the network',
                type: 'integer',
                unit: 'hours',
                readOnly: true,
                value: -1,
            })
        );

        this.properties.set('days',
            new NetworkMonitorProperty(this, 'days', {
                title: 'Days since last seen',
                description: 'The number of days since the device was last contactable on the network',
                type: 'integer',
                unit: 'days',
                readOnly: true,
                value: -1,
            })
        );

        this.properties.set('address',
            new NetworkMonitorProperty(this, 'address', {
                title: 'IP address',
                description: 'The IP address of the device',
                type: 'string',
                readOnly: true,
            })
        );

        this.properties.set('expiry',
            new NetworkMonitorProperty(this, 'expiry', {
                title: 'Units to expiry',
                description: 'The number of units after which the device is no longer considered present',
                type: 'integer',
                minimum: 1,
                maximum: 60*60*24*31,   // 1 month
                value: 600,             // 10 minutes
            })
        );

        this.properties.set('expiryUnits',
            new UnitsNetworkMonitorProperty(this, 'expiryUnits', {
                title: 'Units of expiry',
                description: 'The units of the expiry setting',
                type: 'string',
                enum: ['seconds', 'minutes', 'hours', 'days'],
                value: 'seconds',
            })
        );
    }

    // this should always execute after the object is fully setup
    updateSeen() {
        this.lastSeen = Date.now();
        this.findProperty('seconds').set(0);
        this.findProperty('minutes').set(0);
        this.findProperty('hours').set(0);
        this.findProperty('days').set(0);
        this.findProperty('present').set(true);
    }

    // may be executed while the object is partially setup, so check everything
    tick() {
        const seconds = this.findProperty('seconds');
        const minutes = this.findProperty('minutes');
        const hours = this.findProperty('hours');
        const days = this.findProperty('days');
        const present = this.findProperty('present');
        const expiry = this.findProperty('expiry');
        if (this.lastSeen !== -1 && seconds && minutes && hours && days && present && expiry) {
            const now = Date.now();
            const secondsSince = (now - this.lastSeen) / 1000;
            seconds.set(Math.floor(secondsSince));
            minutes.set(Math.floor(secondsSince / 60));
            hours.set(Math.floor(secondsSince / (60*60)));
            days.set(Math.floor(secondsSince / (60*60*24)));
            present.set(Math.floor(secondsSince / this.factor) < expiry.get());
        }
    }

    // may be executed while the object is partially setup, so check everything
    onGranularityChange(newValue) {
        const expiryUnits = this.properties.get('expiryUnits');
        const expiry = this.properties.get('expiry');
        if (expiry && expiryUnits) {
            const lookup = expiryUnits.lookups[newValue];
            expiry.setCachedValueAndNotify(lookup.default);
            this.factor = lookup.factor;
        }
    }

}

module.exports = { NetworkMonitorDevice, NetworkMonitorProperty, UnitsNetworkMonitorProperty };
