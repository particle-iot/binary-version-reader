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

const moduleEncoding = require('./lib/moduleEncoding');
const config = require('./lib/config');

module.exports = {
  HalModuleParser: require('./lib/HalModuleParser.js'),
  HalDescribeParser: require('./lib/HalDescribeParser.js'),
  HalDependencyResolver: require('./lib/HalDependencyResolver.js'),
  FirmwareModule: require('./lib/FirmwareModule.js'),
  ModuleInfo: require('./lib/ModuleInfo.js'),
  firmwareTestHelper: require('./lib/firmwareTestHelper'),
  ...moduleEncoding,
  ...config
};
