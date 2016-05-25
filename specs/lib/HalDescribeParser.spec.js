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

var fs = require('fs');
var should = require('should');

var FirmwareModule = require('../../lib/FirmwareModule');
var HalDescribeParser = require('../../lib/HalDescribeParser');

describe('Describe parser', function() {
	describe('getModules', function(){
		it('returns null when describe is incorrect', function(){
			var parser = new HalDescribeParser();
			should(parser.getModules()).be.null;
			should(parser.getModules({})).be.null;
			should(parser.getModules({m: 'foo'})).be.null;
		});

		it('returns FirmwareModules from describe', function(){
			var data = require('./../describes/fixed_dependencies_describe.json.js');
			var parser = new HalDescribeParser();
			var results = parser.getModules(data);
			results.length.should.eql(5);
			should(results[0] instanceof FirmwareModule).be.true;
		});
	});

	describe('getSystemVersion', function(){
		it('returns null when describe is incorrect', function(){
			var parser = new HalDescribeParser();
			should(parser.getSystemVersion()).be.null;
			var data = require('./../describes/describe_one_systemmodule.json.js');
			should(parser.getSystemVersion(data)).be.null;
			data = require('./../describes/describe.json.js');
			should(parser.getSystemVersion(data)).be.null;
		});

		it('returns system version', function(){
			var data = require('./../describes/fixed_dependencies_describe.json.js');
			var parser = new HalDescribeParser();
			parser.getSystemVersion(data).should.eql(2);
		});
	});
});
