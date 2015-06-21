/**
 * Created by middleca on 6/18/15.
 */

var fs = require('fs');
var path = require("path");
var when = require('when');
var pipeline = require('when/pipeline');
var util = require('util');

var HalModuleParser = require('./HalModuleParser.js');


var HalDependencyResolver = function() {

};
HalDependencyResolver.prototype = {

	/**
	 * expects a fileBuffer and the JSON describe payload for the 'm' modules array
	 * @param describe
	 * @param fileBuffer
	 * @returns {*}
	 */
	parse_and_resolve: function(describe, fileBuffer) {
		if (!Buffer.isBuffer(fileBuffer)) {
			return when.reject("fileBuffer was invalid");
		}

		var parser = new HalModuleParser();
		var fileInfo = {
			filename: "user-file",
			fileBuffer: fileBuffer
		};

		var that = this;
		return pipeline([
			function() {
				return parser.parseBuffer(fileInfo);
			},
			function() {
				return that.resolve_dependencies(describe, fileInfo);

			}
		]);
	},

	/**
	 * splice stuff onto the start of an array.
	 * @param arr
	 * @param insArr
	 * @returns {*}
	 * @private
	 */
	_array_insert: function(arr, insArr) {
		return insArr.concat(arr);
	},

	/**
	 *
	 * @param describe
	 * @param fileInfo
	 * @returns {*}
	 */
	resolve_dependencies: function(describe, fileInfo) {
		if (!describe || !util.isArray(describe)) {
			return when.reject("wrong describe payload given");
		}

		if (!fileInfo) {
			return when.reject("no fileInfo provided");
		}

		console.log("resolving dependencies for ", fileInfo.filename);

		var that = this;
		return pipeline([
			function() {
				// find out what we need for the binary described by fileInfo
				return that.solve(describe, fileInfo.prefixInfo);
			},
			function(modules) {
				if (!modules || (modules.length <= 0)) {
					return when.reject("no updates needed");
				}

				// go get the module that we need if we have it.
				return that.retrieveModules(modules);
			},
			function(updates) {
				if (!updates || (updates.length <= 0)) {
					return when.reject("no updates available");
				}

				// go figure out if the updates we found
				var promises = [];
				for(var i = 0; i < updates.length; i++) {
					var promise = that.resolve_dependencies(describe, updates[i]);
					promises.push(promise);
				}

				return when.all(promises)
					.then(function(arr) {
						for(var i=0;i<arr.length;i++) {
							var resvArr = arr[i];
							if (resvArr && (resvArr.length > 0)) {
								// insert these new dependencies at the start of the array
								updates = resvArr.concat(updates);
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

	 we grab this new module, and before we send that, check again to see what it requires.

	 it doesn't have dependencies, so we send:

	 part1,
	 part2,
	 user-app


--> therefore, we need a step, post solve, that grabs our binary, and does a dependency check on it,
	how do we know to keep going?
		// if we suggest a file,
		// we need to be able to grab that file and re-process it.
	  */


	/***
	 * go read in the file, parse the data for it, convert its precious contents to JSON.
	 * @param filename
	 * @returns {boolean}
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
				fileInfo.describe = that._binary_to_describe(fileInfo.prefixInfo);

				that._moduleStorage.push(fileInfo);
			},
			function(err) {
				console.error("assimilateModule err: ", err);
			});
	},

	/**
	 * expects the array of module descriptions back from the solve routine
	 * @param modules
	 * @returns a module description result complete with fileBuffer
	 */
	retrieveModules: function(modules) {
		// expects that we've been given storage of all our available modules, and their binary info.
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
		for(var i=0;i<modules.length;i++) {
			var m = modules[i];


			//iterate over what's available
			for(var a=0;a<this._moduleStorage.length;a++) {
				var module = this._moduleStorage[a];
				var avail = module.describe;	//grab the converted bits

				var isMatch = ((avail.n == m.n)
					&& (avail.f == m.f)
					&& (avail.v >= m.v));

				//console.log("comparing ", m, avail);

				if (isMatch) {
					results.push(module);
					break;
				}
			}
		}
		return results;
	},




	/**
	 * given what modules are "described" as being on a photon, and target binary info,
	 * figure out which modules need to be updated on that photon.
	 *
	 * @param device_modules
	 * @param binary_info
	 */
	solve: function(device_modules, binary_info) {
		var safe_device_modules = this._repairDescribeErrors(device_modules);
		var safe_binary_requires = this._binary_deps_to_describe(binary_info);

		return this._walk_chain(safe_device_modules, safe_binary_requires);
	},

	/**
	 * walk over the described modules until we've resolved our dependency chain for all the dependent things
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
	_walk_chain: function(modules, needs, arr) {
		arr = arr || [];


		for (var i=0;i<modules.length;i++) {
			var m = modules[i];

			if (m.n != needs.n) {
				continue;
			}
			if (m.f != needs.f) {
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

				arr.push(m);

				// if we're updating this, we better check its dependencies too.
				if (m.d && (m.d.length > 0)) {
					//oh no!  this module has dependencies!
					// do we have to udpate those too?
					// (this doesn't fully make sense to me right now, but lets go with it.)

					arr = this._walk_chain(modules, m, arr);
				}
			}
		}

		return arr;
	},


	/**
	 * for modules in 'location:main'
	 * not for user modules 'function:user'
	 *
	 * for modules with 'function:system' or 'function:bootloader'
	 *
	 * fix the array so that 'n' is ascending "0", "1", "2" ...
	 * set any missing version to 'version:0'
	 * set missing function to 'function:system'
	 *
	 *
	 * @param describe_info
	 */
	_repairDescribeErrors: function(describe_info) {
		var arr = describe_info;


		//we're assuming the modules are in the reported order, which should be dependency order.

		// essentially we're looking to add this to the correct module:
		//	f: "s", n: "1", v: 1,

		for(var i = 0; i < arr.length; i++) {
			var item = arr[i];

			if (item.l != "m") {
				//not stored in main
				continue;
			}
			else if (item.f == "u") {
				//I'm a user module, bail
				break;
			}

			// are we the first thing and we don't have a name?
			if ((i == 0) && (!item.n)) {
				item.n = i + "";
			}

			//skip the first one.
			if (i == 0) {
				continue;
			}

			// i is at least 1
			var lastItem = arr[i - 1];
			//var nextOne = ((i+1) < arr.length) ? arr[i+1] : null;

			if (lastItem.n && !item.n) {
				//last one had a name, and I don't have a name.
				item.n = (parseInt(lastItem.n) + 1) + "";

				if (!item.f) {
					// was missing a function designation
					item.f = "s";
				}
				if (!item.v) {
					// was missing a version number
					item.v = 0;
				}
			}
		}
		return describe_info;
	},


	/**
	 * the binary prefix contains a numeric value for its dependent module function
	 * convert that number into the same characters reported by the photon (s, u, b, etc)
	 *
	 * @param moduleFunction
	 * @returns {*}
	 * @private
	 */
	_mod_func_to_char: function(moduleFunction) {
		var result;

		//var moduleFunctions = [ "system" | "user" | "boot" | "res" | "mono" ];

		switch (moduleFunction) {
			case 0:
				result = null;	// undefined / none?
				break;
			case 1:
				result = "1_unknown";
				break;
			case 2:
				result = "b";	// bootloader?
				break;
			case 3:
				result = "3_unknown";
				break;
			case 4:
				result = "s";	// system?
				break;
			case 5:
				result = "u";	// user?
				break;

			default:
				result = "undefined";
				break;
		}
		return result;
	},

	/**
	 * convert the 'dependency' keys from the binary prefix info into the common JSON
	 * format used by the describe messages.
	 *
	 * @private
	 */
	_binary_deps_to_describe: function(binaryInfo) {
		var result = {};
		if (!binaryInfo) {
			return result;
		}

		var keys = Object.keys(binaryInfo);

		// iterate over the prefix info, looking for the keys we need.
		for(var i = 0; i < keys.length; i++) {
			var key = keys[i];
			var value = binaryInfo[key];

			switch (key) {
				case "depModuleFunction":
					result.f = this._mod_func_to_char(value);
					break;

				case "depModuleIndex":
					result.n = value + "";
					break;

				case "depModuleVersion":
					result.v = value;
					break;
			}
		}

		return result;
	},

	/**
	 * convert the binary function/name/index/version keys from the binary prefix info into the common JSON
	 * format used by the describe messages.
	 *
	 * NOTE: this is separate so as to not conflict with the dependency conversion above.
	 *
	 * @private
	 */
	_binary_to_describe: function(binaryInfo) {
		if (!binaryInfo) {
			return null;
		}
		else if (typeof binaryInfo != "object") {
			console.log("HERE", binaryInfo);
		}

		var result = {};
		var keys = Object.keys(binaryInfo);

		// iterate over the prefix info, looking for the keys we need.
		for(var i = 0; i < keys.length; i++) {
			var key = keys[i];
			var value = binaryInfo[key];

			switch (key) {
				case "moduleFunction":
					result.f = this._mod_func_to_char(value);
					break;

				case "moduleIndex":
					result.n = value + "";
					break;

				case "moduleVersion":
					result.v = value;
					break;
			}
		}

		return result;
	},




	_: null
};
module.exports = HalDependencyResolver;