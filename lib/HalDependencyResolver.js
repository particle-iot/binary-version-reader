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

var fs = require('fs');
var when = require('when');
var pipeline = require('when/pipeline');
var extend = require('xtend');
var util = require('util');
var utilities = require('./utilities.js');

var HalModuleParser = require('./HalModuleParser.js');
var FirmwareModule = require('./FirmwareModule');

/**
 * fancy module that can assimilate system modules and their version info.
 * It uses that combined with the describe payload from your device, and
 * the version info from a new binary to recursively resolve
 * any missing modules you might need to run that firmware.  **phew!**
 *
 * @constructor
 */
var HalDependencyResolver = function() {

};
HalDependencyResolver.prototype = {

	/*
	 * expects a fileBuffer and the JSON describe payload for the 'm'
	 * modules array
	 *
	 * @param Object describe
	 * @param Buffer fileBuffer
	 * @returns Promise
	 */
	parseAndResolve: function(describe, fileBuffer) {
		if (describe && !util.isArray(describe) && describe.m) {
			// those goofs, they sent the whole thing, instead of just the
			// modules section.
			describe = describe.m;
		}

		if (!Buffer.isBuffer(fileBuffer)) {
			return when.reject('fileBuffer was invalid');
		}

		var parser = new HalModuleParser();
		var fileInfo = {
			filename: 'user-file',
			fileBuffer: fileBuffer
		};

		var that = this;
		return pipeline([
			function() {
				return parser.parseBuffer(fileInfo);
			},
			function() {
				return that.resolveDependencies(describe, fileInfo);
			}
		]);
	},

	/*
	 *
	 * @param Object describe
	 * @param Object fileInfo
	 * @returns Promise
	 */
	resolveDependencies: function(describe, fileInfo) {
		if (!describe || !util.isArray(describe)) {
			return when.reject('wrong describe payload given');
		}

		if (!fileInfo) {
			return when.reject('no fileInfo provided');
		}

		console.log('resolving dependencies for ', fileInfo.filename);

		var that = this;
		return pipeline([
			function() {
				// find out what we need for the binary described by fileInfo
				return that.solve(describe, fileInfo.prefixInfo);
			},
			function(modules) {
				if (!modules || (modules.length <= 0)) {
					return when.resolve([]);		//no updates needed
				}

				// go get the module that we need if we have it.
				return that.retrieveModules(modules);
			},
			function(updates) {
				if (!updates || (updates.length <= 0)) {
					return when.resolve([]); 	//'no updates available'
				}

				// go figure out if the updates we found
				var promises = [];
				for (var i = 0; i < updates.length; i++) {
					var promise = that.resolveDependencies(describe, updates[i]);
					promises.push(promise);
				}

				return when.all(promises)
					.then(function(arr) {
						for (var j = 0; j < arr.length; j++) {
							var resvArr = arr[j];
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
						return when.resolve(updates);
					},
					function(err) {
						return when.resolve(updates);
					});
			}
		]);
	},


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


	/*
	 * go read in the file, parse the data for it, convert its precious
	 * contents to JSON.
	 *
	 * @param String filename
	 * @returns Boolean
	 */
	assimilateModule: function(filename) {
		if (!fs.existsSync(filename)) {
			return false;
		}

		if (!this._moduleStorage) {
			this._moduleStorage = [];
		}

		var that = this;
		var parser = new HalModuleParser();
		return parser.parseFile(filename)
			.then(
			function(fileInfo) {
				fileInfo.describe = that._binaryToDescribe(fileInfo.prefixInfo);

				that._moduleStorage.push(fileInfo);
			},
			function(err) {
				console.error('assimilateModule err: ', err);
			});
	},

	/*
	 * expects the array of module descriptions back from the solve routine
	 * and returns amodule description result complete with fileBuffer
	 * @param Array modules
	 * @returns Object
	 */
	retrieveModules: function(modules) {
		// expects that we've been given storage of all our available
		// modules, and their binary info.
		if (!this._moduleStorage) {
			return null;
		}

		if (!modules || (modules.length <= 0)) {
			return null;
		}

		var results = [];

		// expecting something like...
		// { f: "s", n: "2", v: 2 }


		//iterate over our requirements
		for (var i = 0; i < modules.length; i++) {
			var m = modules[i];


			//iterate over what's available
			for (var a = 0; a < this._moduleStorage.length; a++) {
				var module = this._moduleStorage[a];
				var avail = module.describe;	//grab the converted bits

				var isMatch = ((avail.n === m.n)
					&& (avail.f === m.f)
					&& (avail.v >= m.v));

				//console.log('comparing ', m, avail);

				if (isMatch) {
					results.push(module);
					break;
				}
			}
		}
		return when.resolve(results);
	},




	/*
	 * given what modules are 'described' as being on a photon,
	 * and target binary info, figure out which modules need to be updated
	 * on that photon.
	 *
	 * @param deviceModules
	 * @param binaryInfo
	 */
	solve: function(deviceModules, binaryInfo) {
		var safeDeviceModules = this._repairDescribeErrors(deviceModules);
		var safeBinaryRequires = this._binaryDepsToDescribe(binaryInfo);

		return this._walkChain(safeDeviceModules, safeBinaryRequires);
	},

	/*
	 * given what modules are 'described' as being on a device,
	 * and known firmware module info, figure out which modules need
	 * to be updated on the device.
	 *
	 * @param deviceModules
	 * @param firmwareModule
	 */
	solveFirmwareModule: function(deviceModules, firmwareModule) {
		var safeDeviceModules = this._repairDescribeErrors(deviceModules);
		var safeModuleRequires = firmwareModule.toDescribe();
		
		return this._walkChain(safeDeviceModules, safeModuleRequires);
	},

	/*
	 * given device's describe message figure out if it has
	 * missing modules. Rejected value contains missing
	 * dependencies
	 *
	 * @param Object describe - describe message
	 * @param Promise
	 */
	userModuleHasMissingDependencies: function(describe) {
		if (!Array.isArray(describe.m)) {
			return when.reject('no modules in describe message');
		}

		var modules = [];
		var userModule = null;
		for (var i = 0; i < describe.m.length; i++) {
			var module = new FirmwareModule(describe.m[i]);
			//modules.push(module);

			if (module.isUserModule() && module.isMainLocation()) {
				userModule = describe.m[i];
			}
		}

		if (!userModule) {
			return when.resolve("no user module");
		}

		//return this._getModuleFirstDependecy(modules, userModule);

		for(var i=0;i<userModule.d.length;i++) {
			var dep = userModule.d[i];

			var deps = this._walkChain(describe.m, dep);
			if (deps && (deps.length > 0)) {
				// this function only originally returned one dependency.
				return when.reject([new FirmwareModule(deps[0])]);
			}
		}


//		if (deps && (deps.length > 0)) {
//			return when.reject(new FirmwareModule(deps[0]));
//		}
//		else {
			return when.resolve("nothing missing");
//		}
	},

	/**
	 * tell us if anything with dependencies is missing something
	 *
	 * (this covers scenarios where user app needs something else, or user app has no deps, and part 1 is old, but
	 * part2 is current, etc.)  Built this because I hit this during testing.
	 *
	 * in what order should we apply updates?
	 * is it possible for us to get conflicting / out of order update recommendations?!
	 *
	 * @param describe
	 */
	findAnyMissingDependencies: function(describe) {
		if (!Array.isArray(describe.m)) {
			return when.reject('no modules in describe message');
		}

		var allDeps = [];
		var modules = describe.m;

		for(var i=0;i<modules.length;i++) {
			var checkModule = modules[i];

			// don't look for dependencies of things that don't have dependencies.
			// they'll never cause safe mode as a result of their requirements,
			// and they're probably referenced by other things

			for(var d = 0; d < checkModule.d.length; d++) {
				var moduleNeeds = checkModule.d[d];

				// what things do we need that we don't have?
				var deps = this._walkChain(modules, moduleNeeds);
				if (deps && (deps.length > 0)) {
					allDeps = allDeps.concat(deps);
				}
			}
		}

		var keyFn = function(dep) {
			return [dep.f, dep.n, dep.v].join('_');
		};
		return utilities.dedupArray(allDeps, keyFn);
	},

	/*
	 * walk over the described modules until we've resolved our
	 * dependency chain for all the dependent things
	 * that need updating.
	 *
	 * (typically system module 1, and 2)
	 *
	 * @param modules - what was in the describe message
	 * @param needs - what was described in the binary header info
	 * @param [arr] - our accumulator array
	 * @returns {*|Array}
	 * @private
	 */
	_walkChain: function(modules, needs, arr) {
		arr = arr || [];


		for (var i = 0; i < modules.length; i++) {
			var m = modules[i];

			if (m.n !== needs.n) {
				continue;
			}
			if (m.f !== needs.f) {
				continue;
			}

			//found one!
			if (m.v < needs.v) {
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

				//arr.push(m);

				// instead of returning the module we found, lets return the module with the version we need,
				// and any dependencies it requires, I think that's more clear.

				var missing = extend(m, { v: needs.v });
				arr.push(missing);

				// if we're updating this, we better check its dependencies too.
				if (m.d && (m.d.length > 0)) {
					//oh no!  this module has dependencies!
					// do we have to update those too?
					// (this doesn't fully make sense to me right now, but lets go with it.)

					arr = this._walkChain(modules, m, arr);
				}
			}
		}

		return arr;
	},


	/*
	 * for modules in 'location:main'
	 * not for user modules 'function:user'
	 *
	 * for modules with 'function:system' or 'function:bootloader'
	 *
	 * fix the array so that 'n' is ascending '0', '1', '2' ...
	 * set any missing version to 'version:0'
	 * set missing function to 'function:system'
	 *
	 *
	 * @param describeInfo
	 */
	_repairDescribeErrors: function(describeInfo) {
		var arr = describeInfo;


		// we're assuming the modules are in the reported order,
		// which should be dependency order.

		// essentially we're looking to add this to the correct module:
		//	f: 's', n: '1', v: 1,

		for (var i = 0; i < arr.length; i++) {
			var item = arr[i];

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
			var lastItem = arr[i - 1];
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
	},


	/*
	 * the binary prefix contains a numeric value for its dependent
	 * module function convert that number into the same characters
	 * reported by the photon (s, u, b, etc)
	 *
	 * @param moduleFunction
	 * @returns {*}
	 * @private
	 */
	_modFuncToChar: function(moduleFunction) {
		var result;

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
	},

	/*
	 * convert the 'dependency' keys from the binary prefix info into
	 * the common JSON
	 * format used by the describe messages.
	 *
	 * @private
	 */
	_binaryDepsToDescribe: function(binaryInfo) {
		var result = {};
		if (!binaryInfo) {
			return result;
		}

		var keys = Object.keys(binaryInfo);

		// iterate over the prefix info, looking for the keys we need.
		for (var i = 0; i < keys.length; i++) {
			var key = keys[i];
			var value = binaryInfo[key];

			switch (key) {
				case 'depModuleFunction':
					result.f = this._modFuncToChar(value);
					break;

				case 'depModuleIndex':
					result.n = value + '';
					break;

				case 'depModuleVersion':
					result.v = value;
					break;
			}
		}

		return result;
	},

	/*
	 * convert the binary function/name/index/version keys from the binary
	 * prefix info into the common JSON format used by the describe messages.
	 *
	 * NOTE: this is separate so as to not conflict with the dependency
	 * conversion above.
	 *
	 * @private
	 * @param Object binaryInfo
	 * @returns Object
	 */
	_binaryToDescribe: function(binaryInfo) {
		if (!binaryInfo) {
			return null;
		}
//		else if (typeof binaryInfo !== 'object') {
//			console.log('HERE', binaryInfo);
//		}

		var result = {};
		var keys = Object.keys(binaryInfo);

		// iterate over the prefix info, looking for the keys we need.
		for (var i = 0; i < keys.length; i++) {
			var key = keys[i];
			var value = binaryInfo[key];

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
	},


	_: null
};
module.exports = HalDependencyResolver;
