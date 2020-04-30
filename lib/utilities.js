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

const { globalConfig } = require('./config');

/**
 * Created by middleca on 6/11/15.
 */

module.exports = {
	dedupArray: function(arr, keyFn) {
		if (!keyFn) {
			return arr;
		}

		var results = [];
		var hash = {};

		for(var i=0;i<arr.length;i++) {
			var dep = arr[i];
			var key = keyFn(dep);

			if (hash[key]) {
				continue;
			}
			hash[key] = true;

			results.push(dep);
		}
		return results;
	},

	crc32: function(buf) {
		return globalConfig.crc32(buf);
	},

	_: null
};
