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
 * Browser-safe entry point.
 *
 * Exports only modules that work in the browser (no fs, crypto, zlib, etc.).
 * Requires stubbing `fs` in the bundler (e.g. webpack resolve.fallback: { fs: false }).
 */

module.exports = {
	HalModuleParser: require('./lib/HalModuleParser.js'),
	ModuleInfo: require('./lib/ModuleInfo.js'),
};
