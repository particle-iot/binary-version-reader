/*
 *  Copyright 2015 Particle ( https://particle.io )
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/**
 * Created by middleca on 6/18/15.
 */

'use strict';

const fs = require('fs');
const utilities = require('./utilities.js');

const HalModuleParser = require('./HalModuleParser.js');
const FirmwareModule = require('./FirmwareModule');
const ModuleInfo = require('./ModuleInfo');

/**
 * @import { FileInfo, PrefixInfo } from './HalModuleParser'
 * @import { DescribeModule } from './FirmwareModule'
 * @import { Describe } from './HalDescribeParser'
 */

/**
 * A module loaded with `assimilateModule()`.
 *
 * @typedef {FileInfo & { describe: DescribeModule | null }} AssimilatedModule
 */

/**
 * fancy module that can assimilate system modules and their version info.
 * It uses that combined with the describe payload from your device, and
 * the version info from a new binary to recursively resolve
 * any missing modules you might need to run that firmware.  **phew!**
 */
class HalDependencyResolver {

	/**
	 * expects a fileBuffer and the JSON describe payload for the 'm'
	 * modules array
	 *
	 * @param {Describe | DescribeModule[]} describe The describe message, or its module list
	 * @param {Buffer} fileBuffer
	 * @returns {Promise<AssimilatedModule[]>} The assimilated modules the binary needs, dependencies first
	 */
	async parseAndResolve(describe, fileBuffer) {
		if (describe && !Array.isArray(describe) && describe.m) {
			// those goofs, they sent the whole thing, instead of just the
			// modules section.
			describe = describe.m;
		}

		if (!Buffer.isBuffer(fileBuffer)) {
			throw new Error('fileBuffer was invalid');
		}

		const parser = new HalModuleParser();
		const fileInfo = {
			filename: 'user-file',
			fileBuffer: fileBuffer
		};

		await parser.parseBuffer(fileInfo);
		return this.resolveDependencies(describe, fileInfo);
	}

	/**
	 * @param {DescribeModule[]} describe The modules on the device (`describe.m`)
	 * @param {FileInfo} fileInfo
	 * @returns {Promise<AssimilatedModule[]>} The assimilated modules the binary needs, dependencies first
	 */
	async resolveDependencies(describe, fileInfo) {
		if (!describe || !Array.isArray(describe)) {
			throw new Error('wrong describe payload given');
		}

		if (!fileInfo) {
			throw new Error('no fileInfo provided');
		}

		console.log('resolving dependencies for ', fileInfo.filename);

		const modules = await this.solve(describe, fileInfo.prefixInfo);
		let updates = [];
		if (modules && (modules.length > 0)) {
			updates = await this.retrieveModules(modules);
		}

		if (!updates || (updates.length <= 0)) {
			return []; 	//'no updates available'
		}

		// go figure out if the updates we found
		const promises = [];
		for (let i = 0; i < updates.length; i++) {
			const promise = this.resolveDependencies(describe, updates[i]);
			promises.push(promise);
		}

		return Promise.all(promises)
			.then(function(arr) {
				for (let j = 0; j < arr.length; j++) {
					const resvArr = arr[j];
					if (resvArr && (resvArr.length > 0)) {

						//NOTE: the photon isn't accepting updates in this order
						// part1, part2, user
						// insert these new dependencies at the start of the array
						updates = resvArr.concat(updates);

						// so lets flip that to
						// part2, part1, user
						//updates = updates.concat(resvArr);
					}
				}
				return updates;
			},
			function() {
				return updates;
			});
	}


	/*
		so, lets take our typical path:

		user has old system modules, compiles new firmware.

		new firmware requires new system 2 module,

		we figure this out, and grab new module

		before we send that, we check this new module to see what it requires.

		turns out it requires a new system 1 module.

		we grab this new module, and before we send that, check again to see
		what it requires.

		it doesn't have dependencies, so we send:

		part1,
		part2,
		user-app


--> therefore, we need a step, post solve, that grabs our binary, and does
	a dependency check on it,
	how do we know to keep going?
		// if we suggest a file,
		// we need to be able to grab that file and re-process it.
	  */


	/**
	 * go read in the file, parse the data for it, convert its precious
	 * contents to JSON.
	 *
	 * @param {string} filename
	 * @returns {Promise<false | undefined>} `false` when the file doesn't exist
	 */
	async assimilateModule(filename) {
		if (!fs.existsSync(filename)) {
			return false;
		}

		if (!this._moduleStorage) {
			/** @type {AssimilatedModule[] | undefined} */
			this._moduleStorage = [];
		}

		const parser = new HalModuleParser();
		try {
			const fileInfo = await parser.parseFile(filename);
			fileInfo.describe = this._binaryToDescribe(fileInfo.prefixInfo);
			this._moduleStorage.push(fileInfo);
		} catch (error) {
			console.error('assimilateModule err: ', error);
		}
	}

	/**
	 * expects the array of module descriptions back from the solve routine
	 * and returns amodule description result complete with fileBuffer
	 * @param {DescribeModule[]} modules
	 * @returns {Promise<AssimilatedModule[] | null>} `null` when nothing was assimilated or `modules` is empty
	 */
	async retrieveModules(modules) {
		// expects that we've been given storage of all our available
		// modules, and their binary info.
		if (!this._moduleStorage) {
			return null;
		}

		if (!modules || (modules.length <= 0)) {
			return null;
		}

		const results = [];

		// expecting something like...
		// { f: "s", n: "2", v: 2 }


		//iterate over our requirements
		for (let i = 0; i < modules.length; i++) {
			const m = modules[i];

			//iterate over what's available
			for (let a = 0; a < this._moduleStorage.length; a++) {
				const module = this._moduleStorage[a];
				const avail = module.describe;	//grab the converted bits

				const isMatch = ((avail.n === m.n)
					&& (avail.f === m.f)
					&& (avail.v >= m.v));

				//console.log('comparing ', m, avail);

				if (isMatch) {
					results.push(module);
					break;
				}
			}
		}
		return results;
	}




	/**
	 * given what modules are 'described' as being on a photon,
	 * and target binary info, figure out which modules need to be updated
	 * on that photon.
	 *
	 * @param {DescribeModule[]} deviceModules
	 * @param {PrefixInfo} binaryInfo
	 * @returns {DescribeModule[]} The modules to update
	 */
	solve(deviceModules, binaryInfo) {
		const safeDeviceModules = this._repairDescribeErrors(deviceModules);
		const safeBinaryRequires = this._binaryDepsToDescribe(binaryInfo);
		const safeBinaryRequires2 = this._binaryDepsToDescribe(binaryInfo, 2);

		const result =  this._walkChain(safeDeviceModules, safeBinaryRequires);
		this._walkChain(safeDeviceModules, safeBinaryRequires2, result);
		return result;
	}

	/**
	 * given what modules are 'described' as being on a device,
	 * and known firmware module info, figure out which modules need
	 * to be updated on the device.
	 *
	 * @param {DescribeModule[]} deviceModules
	 * @param {FirmwareModule} firmwareModule
	 * @returns {DescribeModule[]} The modules to update
	 */
	solveFirmwareModule(deviceModules, firmwareModule) {
		const safeDeviceModules = this._repairDescribeErrors(deviceModules);
		const safeModuleRequires = firmwareModule.toDescribe();

		return this._walkChain(safeDeviceModules, safeModuleRequires);
	}

	/**
	 * given device's describe message figure out if it has
	 * missing modules. Rejected value contains missing
	 * dependencies
	 *
	 * @param {Describe} describe describe message
	 * @returns {Promise<string>} Rejects with a one-element `FirmwareModule[]` when a dependency is missing
	 */
	async userModuleHasMissingDependencies(describe) {
		if (!Array.isArray(describe.m)) {
			throw new Error('no modules in describe message');
		}

		const modules = [];
		let userModule = null;
		for (let i = 0; i < describe.m.length; i++) {
			const module = new FirmwareModule(describe.m[i]);
			//modules.push(module);

			if (module.isUserModule() && module.isMainLocation()) {
				userModule = describe.m[i];
			}
		}

		if (!userModule) {
			return "no user module";
		}

		//return this._getModuleFirstDependecy(modules, userModule);

		for (let i = 0; i < userModule.d.length; i++) {
			const dep = userModule.d[i];

			const deps = this._walkChain(describe.m, dep);
			if (deps && (deps.length > 0)) {
				// this function only originally returned one dependency.
				throw [new FirmwareModule(deps[0])];
			}
		}


//		if (deps && (deps.length > 0)) {
//			return when.reject(new FirmwareModule(deps[0]));
//		}
//		else {
			return "nothing missing";
//		}
	}

	/**
	 * tell us if anything with dependencies is missing something
	 *
	 * (this covers scenarios where user app needs something else, or user app has no deps, and part 1 is old, but
	 * part2 is current, etc.)  Built this because I hit this during testing.
	 *
	 * in what order should we apply updates?
	 * is it possible for us to get conflicting / out of order update recommendations?!
	 *
	 * @param {Describe} describe The describe message from the device
	 * @param {object} [options] Optional options controlling which dependencies are checked
	 * @param {boolean} [options.includeFactoryFirmware] When true, firmware at the factory location is included.
	 * @returns {DescribeModule[] | undefined} `undefined` when the describe message has no module list
	 */
	findAnyMissingDependencies(describe, options) {
		if (!Array.isArray(describe.m)) {
			return;
		}

		let allDeps = [];
		const modules = describe.m;

		for(let i=0;i<modules.length;i++) {
			const checkModule = modules[i];

			if (checkModule.l === 'f' && !(options && options.includeFactoryFirmware)) {
				continue;
			}

			// don't look for dependencies of things that don't have dependencies.
			// they'll never cause safe mode as a result of their requirements,
			// and they're probably referenced by other things

			for(let d = 0; d < checkModule.d.length; d++) {
				const moduleNeeds = checkModule.d[d];

				// what things do we need that we don't have?
				const deps = this._walkChain(modules, moduleNeeds);
				if (deps && (deps.length > 0)) {
					allDeps = allDeps.concat(deps);
				}
			}
		}

		const keyFn = function(dep) {
			return [dep.f, dep.n, dep.v || ''].join('_');
		};
		return utilities.dedupArray(allDeps, keyFn);
	}

	/**
	 * walk over the described modules until we've resolved our
	 * dependency chain for all the dependent things
	 * that need updating.
	 *
	 * (typically system module 1, and 2)
	 *
	 * @param {DescribeModule[]} modules what was in the describe message (the modules on the device)
	 * @param {DescribeModule} needs what was described in the binary header info - the dependencies being checked
	 * @param {DescribeModule[]} [arr] our accumulator array
	 * @returns {DescribeModule[]}
	 */
	_walkChain(modules, needs, arr) {
		arr = arr || [];

		// Skip dependencies with function = "none"
		if (needs.f === ModuleInfo.FunctionChar.NONE) {
			return arr;
		}

		let foundModule = null;

		for (const m of modules) {
			if (m.n === needs.n && m.f === needs.f) {
				foundModule = m;
				break;
			}
		}

		if (!foundModule) {
			// Module is not present in the list of modules on the device
			// Simply return the dependency as-is
			arr.push(needs);
		} else if (foundModule.v < needs.v) {
			//
			// it's...
			//	  .---.       .-''-.     .-'''-.    .-'''-.     ,---------. .---.  .---.    ____    ,---.   .--.
			//	  | ,_|     .'_ _   \   / _     \  / _     \    \          \|   |  |_ _|  .'  __ `. |    \  |  |
			//	,-./  )    / ( ` )   ' (`' )/`--' (`' )/`--'     `--.  ,---'|   |  ( ' ) /   '  \  \|  ,  \ |  |
			//	\  '_ '`) . (_ o _)  |(_ o _).   (_ o _).           |   \   |   '-(_{;}_)|___|  /  ||  |\_ \|  |
			//	 > (_)  ) |  (_,_)___| (_,_). '.  (_,_). '.         :_ _:   |      (_,_)    _.-`   ||  _( )_\  |
			//	(  .  .-' '  \   .---..---.  \  :.---.  \  :        (_I_)   | _ _--.   | .'   _    || (_ o _)  |
			//	 `-'`-'|___\  `-'    /\    `-'  |\    `-'  |       (_(=)_)  |( ' ) |   | |  _( )_  ||  (_,_)\  |
			//	  |        \\       /  \       /  \       /         (_I_)   (_{;}_)|   | \ (_ o _) /|  |    |  |
			//	  `--------` `'-..-'    `-...-'    `-...-'          '---'   '(_,_) '---'  '.(_,_).' '--'    '--'
			//

			//arr.push(foundModule);

			// instead of returning the module we found, lets return the module with the version we need,
			// _and cleared dependencies_, as we have no idea what that module actually might require.
			// In previous versions, we used to return dependencies of the old module.
			const missing = { ...foundModule, v: needs.v, d: [] };
			arr.push(missing);

			// if we're updating this, we better check its dependencies too.
			if (foundModule.d && (foundModule.d.length > 0)) {
				//oh no!  this module has dependencies!
				// do we have to update those too?
				// (this doesn't fully make sense to me right now, but lets go with it.)
				// todo mdm - this won't do anything, since `m` is always a satisfied dependency
				// (it came from the modules array.)
				// at the very least we should be iterating over foundModule.d[] as the needed modules
				arr = this._walkChain(modules, foundModule, arr);
			}
		}

		return arr;
	}


	/**
	 * for modules in 'location:main'
	 * not for user modules 'function:user'
	 *
	 * for modules with 'function:system' or 'function:bootloader'
	 *
	 * fix the array so that 'n' is ascending '0', '1', '2' ...
	 * set any missing version to 'version:0'
	 * set missing function to 'function:system'
	 *
	 * Modifies `describeInfo` in place and returns it.
	 *
	 * @param {DescribeModule[]} describeInfo
	 * @returns {DescribeModule[]}
	 */
	_repairDescribeErrors(describeInfo) {
		const arr = describeInfo;


		// we're assuming the modules are in the reported order,
		// which should be dependency order.

		// essentially we're looking to add this to the correct module:
		//	f: 's', n: '1', v: 1,

		for (let i = 0; i < arr.length; i++) {
			const item = arr[i];

			if (item.l !== 'm') {
				//not stored in main
				continue;
			} else if (item.f === 'u') {
				//I'm a user module, bail
				break;
			}

			// are we the first thing and we don't have a name?
			if ((i === 0) && (!item.n)) {
				item.n = i + '';
			}

			//skip the first one.
			if (i === 0) {
				continue;
			}

			// i is at least 1
			const lastItem = arr[i - 1];
			//var nextOne = ((i+1) < arr.length) ? arr[i+1] : null;

			if (lastItem.n && !item.n) {
				//last one had a name, and I don't have a name.
				item.n = (parseInt(lastItem.n) + 1) + '';

				if (!item.f) {
					// was missing a function designation
					item.f = 's';
				}
				if (!item.v) {
					// was missing a version number
					item.v = 0;
				}
			}
		}
		return describeInfo;
	}


	/**
	 * the binary prefix contains a numeric value for its dependent
	 * module function convert that number into the same characters
	 * reported by the photon (s, u, b, etc)
	 *
	 * @param {number} moduleFunction
	 * @returns {string | null} `null` for `NONE`
	 */
	_modFuncToChar(moduleFunction) {
		let result;

		//var moduleFunctions = [ 'system' | 'user' | 'boot' | 'res' | 'mono' ];

		switch (moduleFunction) {
			case 0:
				result = null;	// undefined / none?
				break;
			case 1:
				result = '1_unknown';
				break;
			case 2:
				result = 'b';	// bootloader?
				break;
			case 3:
				result = '3_unknown';		//monolithic?
				break;
			case 4:
				result = 's';	// system?
				break;
			case 5:
				result = 'u';	// user?
				break;

			default:
				result = 'undefined';
				break;
		}
		return result;
	}

	/**
	 * convert the 'dependency' keys from the binary prefix info into
	 * the common JSON
	 * format used by the describe messages.
	 *
	 * @param {PrefixInfo | null} [binaryInfo]
	 * @param {number} [dep] Which dependency to convert: 1 (the default) or 2
	 * @returns {DescribeModule}
	 */
	_binaryDepsToDescribe(binaryInfo, dep) {
		/** @type {DescribeModule} */
		const result = {};
		dep = dep || 1;
		let depString = '';
		if (dep>1) {
			depString = ''+dep;
		}
		if (!binaryInfo) {
			return result;
		}

		const keys = Object.keys(binaryInfo);

		// iterate over the prefix info, looking for the keys we need.
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const value = binaryInfo[key];

			switch (key) {
				case 'dep'+depString+'ModuleFunction':
					result.f = this._modFuncToChar(value);
					break;

				case 'dep'+depString+'ModuleIndex':
					result.n = value + '';
					break;

				case 'dep'+depString+'ModuleVersion':
					result.v = value;
					break;
			}
		}

		return result;
	}

	/**
	 * convert the binary function/name/index/version keys from the binary
	 * prefix info into the common JSON format used by the describe messages.
	 *
	 * NOTE: this is separate so as to not conflict with the dependency
	 * conversion above.
	 *
	 * @param {PrefixInfo | null} [binaryInfo]
	 * @returns {DescribeModule | null}
	 */
	_binaryToDescribe(binaryInfo) {
		if (!binaryInfo) {
			return null;
		}
//		else if (typeof binaryInfo !== 'object') {
//			console.log('HERE', binaryInfo);
//		}

		/** @type {DescribeModule} */
		const result = {};
		const keys = Object.keys(binaryInfo);

		// iterate over the prefix info, looking for the keys we need.
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const value = binaryInfo[key];

			switch (key) {
				case 'moduleFunction':
					result.f = this._modFuncToChar(value);
					break;

				case 'moduleIndex':
					result.n = value + '';
					break;

				case 'moduleVersion':
					result.v = value;
					break;
			}
		}

		return result;
	}
}
module.exports = HalDependencyResolver;
