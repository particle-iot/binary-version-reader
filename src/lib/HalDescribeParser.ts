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
import { FirmwareModule, type DescribeModule } from './FirmwareModule';

// TODO: Move describe related functions here
export class HalDescribeParser {
	/**
	 * Finds the version of the device's system modules, which is the Device OS module version.
	 *
	 * @returns `null` when the describe message has no modules or no system module
	 */
	getSystemVersion(describe?: Describe | null): number | null | undefined {
		const modules = this.getModules(describe);
		if (!modules) {
			return null;
		}
		const systemModules = modules
			.filter((item) => item.isSystemModule())
			.toSorted((a, b) => Number((a.version ?? 0) > (b.version ?? 0)));

		const [first] = systemModules;
		if (!first) {
			// We are expecting at least one system module
			return null;
		}
		// Pick first module and return its version
		return first.version;
	}

	/** @returns `null` when the describe message has no module list */
	getModules(describe?: Describe | null): FirmwareModule[] | null {
		if (!describe || !Array.isArray(describe.m)) {
			return null;
		}
		return describe.m.map((m) => new FirmwareModule(m));
	}
}

/** A device's describe message. Only the module list is read here. */
export interface Describe {
	/** Modules on the device */
	m?: DescribeModule[];
}
