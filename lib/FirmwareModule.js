'use strict';
const ModuleInfo = require('./ModuleInfo.js');

/**
 * One module as reported in a device's describe message (`describe.m`), or one of its dependencies (`d`).
 *
 * @typedef {object} DescribeModule
 * @property {string} [u] UUID (hex-encoded SHA-256 of the module)
 * @property {string} [f] Module function as a `ModuleInfo.FunctionChar`, e.g. `'s'` for a system part
 * @property {string} [l] Location: `'m'` (main) or `'f'` (factory)
 * @property {string} [n] Module index as a string, e.g. `'1'`
 * @property {number} [v] Module version
 * @property {number} [s] Maximum module size in bytes
 * @property {number} [vc] Validity checks performed, as `ModuleInfo.ValidationFlags`
 * @property {number} [vv] Validity checks passed, as `ModuleInfo.ValidationFlags`
 * @property {DescribeModule[]} [d] Dependencies
 */

/**
 * Extracts the short names from a module descriptor and turns them into more readable names.
 */
class FirmwareModule {
	/**
	 * @param {DescribeModule} [describeMessage] The module descriptor message
	 */
	constructor(describeMessage) {
		/** @type {FirmwareModule[]} */
		this.dependencies = [];

		if (describeMessage) {
			// https://github.com/particle-iot/firmware-private/wiki/updating-system-firmware#describe-message-extension
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
	}

	isValid() {
		return this.validityValues === this.validityCheck;
	}

	hasIntegrity() {
		return !!(this.validityValues & (2 << 0));
	}

	areDependenciesValid() {
		return !!(this.validityValues & (2 << 1));
	}

	isImageAddressInRange() {
		return !!(this.validityValues & (2 << 2));
	}

	isImagePlatformValid() {
		return !!(this.validityValues & (2 << 3));
	}

	isImageProductValid() {
		return !!(this.validityValues & (2 << 4));
	}

	isUserModule() {
		return this.func === 'u';
	}

	isSystemModule() {
		return this.func === 's';
	}

	isMainLocation() {
		return this.location === 'm';
	}

	isFactoryLocation() {
		return this.location === 'f';
	}

	/**
	 * Converts this module and its dependencies back to the describe message format.
	 *
	 * @returns {DescribeModule}
	 */
	toDescribe() {
		const dependencies = [];

		for (let i = 0; i < this.dependencies.length; i++) {
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
	}

	/**
	 * @param {DescribeModule[]} deviceModules The modules on the device (`describe.m`)
	 * @param {FirmwareModule[]} [invalidModules] Receives the dependencies that are missing or out of date
	 * @returns {boolean}
	 */
	areDependenciesMet(deviceModules, invalidModules) {
		invalidModules = invalidModules || [];

		if (!deviceModules) {
			return false;
		}

		if (this.dependencies.length === 0) {
			return true;
		}

		const HalDependencyResolver = require('./HalDependencyResolver');
		const resolver = new HalDependencyResolver();

		for (const dep of this.dependencies) {
			const invalidDependencyModules = resolver.solveFirmwareModule(deviceModules, dep);
			invalidModules.push.apply(invalidModules, invalidDependencyModules.map(m => new FirmwareModule(m)));
		}
		return invalidModules.length === 0;
	}
}

/**
 * Module function characters indexed by `ModuleInfo.FunctionType`
 *
 * @type {readonly string[]}
 */
FirmwareModule.prototype.moduleFunctions = ModuleInfo.FunctionToChar;

module.exports = FirmwareModule;
