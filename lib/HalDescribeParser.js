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

var FirmwareModule = require('./FirmwareModule');

// TODO: Move describe related functions here
var HalDescribeParser = function HalDescribeParser() {};
HalDescribeParser.prototype = {
	getSystemVersion: function getSystemVersion(describe) {
		var modules = this.getModules(describe);
		if (!modules) {
			return null;
		}
		var systemModules = modules.filter(function filter(item) {
			return item.isSystemModule();
		}).sort(function sort(a, b) {
			return a.version > b.version;
		});

		if (systemModules.length === 0) {
			// We are expecting at least one system module
			return null;
		}
		// Pick first module and return its version
		return systemModules[0].version;
	},

	getModules: function _getModules(describe) {
		var modules = [];
		if (!describe || !Array.isArray(describe.m)) {
			return null;
		}
		for (var i = 0; i < describe.m.length; i++) {
			modules.push(new FirmwareModule(describe.m[i]));
		}
		return modules;
	},

	_: null
};

module.exports = HalDescribeParser;
