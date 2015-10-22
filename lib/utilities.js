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
 * Created by middleca on 6/11/15.
 */

module.exports = {
	/*
	 * TODO: replace with "buffer.compare" once we move to node 0.12
	 * @param Buffer left
	 * @param Buffer right
	 * @returns Boolean
	 */
	bufferCompare: function(left, right) {
		if ((left === null) && (right === null)) {
			return true;
		} else if ((left === null) || (right === null)) {
			return false;
		}

		if (!Buffer.isBuffer(left)) {
			left = new Buffer(left);
		}
		if (!Buffer.isBuffer(right)) {
			right = new Buffer(right);
		}

		var same = (left.length === right.length),
			i = 0,
			max = left.length;

		while (i < max) {
			same &= (left[i] == right[i]); //eslint-disable-line eqeqeq
			i++;
		}

		return same;
	},

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


	_: null
};
