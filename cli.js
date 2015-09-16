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
 * Created by middleca on 6/23/15.
 */

var HalModuleParser = require('./lib/HalModuleParser.js');
var p = new HalModuleParser();


var args = process.argv;
if (args.length <= 2) {
	console.log('no filename specified');
	process.exit(-1);
}
var filename = process.argv[2];


p.parseFile(filename, function() {
	console.log('got', arguments);
});
