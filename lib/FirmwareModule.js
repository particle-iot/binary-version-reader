'use strict';
var extend = require('xtend');

var FirmwareModule = function FirmwareModule(describeMessage) {
	this.dependencies = [];

	if (describeMessage) {
		// https://github.com/spark/firmware-private/wiki/updating-system-firmware#describe-message-extension
		this.uuid = describeMessage.u;
		this.func = describeMessage.f;
		this.location = describeMessage.l;
		this.name = describeMessage.n;
		this.version = describeMessage.v;
		this.maxSize = describeMessage.s;
		this.validityCheck = describeMessage.vc;
		this.validityValues = describeMessage.vv;

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

	isSystemModule: function() {
		return this.func === 's';
	},

	isMainLocation: function() {
		return this.location === 'm';
	},

	toDescribe: function() {
		var dependencies = [];

		for (var i = 0; i < this.dependencies.length; i++) {
			dependencies.push(this.dependencies[i].toDescribe());
		}

		return {
			u: this.uuid,
			f: this.func,
			l: this.location,
			n: this.name,
			v: this.version,
			s: this.maxSize,
			vc: this.validityCheck,
			vv: this.validityValues,
			d: dependencies
		}
	},

	areDependenciesMet: function(deviceModules) {
		if (!deviceModules) {
			return false;
		}

		if (this.dependencies.length === 0) {
			return true;
		}

		var HalDependencyResolver = require('./HalDependencyResolver');
		var resolver = new HalDependencyResolver();
		var invalidModules = resolver.solveFirmwareModule(deviceModules, this.dependencies[0]);
		return invalidModules.length === 0;
	}
});

module.exports = FirmwareModule;
