'use strict';
var extend = require('xtend');

var FirmwareModule = function FirmwareModule(describeMessage) {
	if (typeof describeMessage !== 'undefined') {
		// https://github.com/spark/firmware-private/wiki/updating-system-firmware#describe-message-extension
		this.uuid = describeMessage.u;
		this.func = describeMessage.f;
		this.location = describeMessage.l;
		this.name = describeMessage.n;
		this.version = describeMessage.v;
		this.maxSize = describeMessage.s;
		this.validityCheck = describeMessage.vc;
		this.validityValues = describeMessage.vv;
		this.dependencies = [];

		if (Array.isArray(describeMessage.d)) {
			describeMessage.d.map(function(dependency){
				this.dependencies.push(new FirmwareModule(dependency));
			}, this);
		}
	}

	return this;
};

FirmwareModule.prototype = extend(FirmwareModule.prototype, {
	moduleFunctions: [
		'n',
		'r',
		'b',
		'm',
		's',
		'u'
	],

	isValid: function() {
		return this.validityValues === this.validityCheck;
	},

	hasIntegrity: function() {
		return !!(this.validityValues & (2 << 0));
	},

	areDependenciesValid: function() {
		return !!(this.validityValues & (2 << 1));
	},

	isImageAddressInRange: function() {
		return !!(this.validityValues & (2 << 2));
	},

	isImagePlatformValid: function() {
		return !!(this.validityValues & (2 << 3));
	},

	isImageProductValid: function() {
		return !!(this.validityValues & (2 << 4));
	},

	isUserModule: function() {
		return this.func === 'u';
	},

	isMainLocation: function() {
		return this.location === 'm';
	}
});

module.exports = FirmwareModule;
