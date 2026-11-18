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

import * as fs from 'fs';

import { FirmwareModule, type DescribeModule } from './FirmwareModule';
import type { Describe } from './HalDescribeParser';
import { HalModuleParser, type FileInfo, type PrefixInfo } from './HalModuleParser';
import * as ModuleInfo from './ModuleInfo';
import * as utilities from './utilities';

/**
 * fancy module that can assimilate system modules and their version info.
 * It uses that combined with the describe payload from your device, and
 * the version info from a new binary to recursively resolve
 * any missing modules you might need to run that firmware.  **phew!**
 */
export class HalDependencyResolver {
	// `declare` emits no class field, so this property only exists once `assimilateModule()` has run
	declare _moduleStorage?: AssimilatedModule[];

	/**
	 * expects a fileBuffer and the JSON describe payload for the 'm'
	 * modules array
	 *
	 * @param describe The describe message, or its module list
	 * @returns The assimilated modules the binary needs, dependencies first
	 */
	async parseAndResolve(describe: Describe | DescribeModule[], fileBuffer: Buffer): Promise<AssimilatedModule[]> {
		if (describe && !Array.isArray(describe) && describe.m) {
			// those goofs, they sent the whole thing, instead of just the
			// modules section.
			describe = describe.m;
		}

		if (!Buffer.isBuffer(fileBuffer)) {
			throw new Error('fileBuffer was invalid');
		}

		const parser = new HalModuleParser();
		const fileInfo = {
			filename: 'user-file',
			fileBuffer: fileBuffer
		};

		return this.resolveDependencies(describe as DescribeModule[], await parser.parseBuffer(fileInfo));
	}

	/**
	 * @param describe The modules on the device (`describe.m`)
	 * @returns The assimilated modules the binary needs, dependencies first
	 */
	async resolveDependencies(describe: DescribeModule[], fileInfo: FileInfo): Promise<AssimilatedModule[]> {
		if (!describe || !Array.isArray(describe)) {
			throw new Error('wrong describe payload given');
		}

		if (!fileInfo) {
			throw new Error('no fileInfo provided');
		}

		// oxlint-disable-next-line no-console
		console.log('resolving dependencies for ', fileInfo.filename);

		const modules = this.solve(describe, fileInfo.prefixInfo);
		let updates: AssimilatedModule[] | null = [];
		if (modules && modules.length > 0) {
			updates = await this.retrieveModules(modules);
		}

		if (!updates || updates.length <= 0) {
			return []; //'no updates available'
		}

		// go figure out if the updates we found
		let resolved: AssimilatedModule[][];
		try {
			resolved = await Promise.all(updates.map((update) => this.resolveDependencies(describe, update)));
		} catch {
			return updates;
		}

		for (const resvArr of resolved) {
			if (resvArr && resvArr.length > 0) {
				//NOTE: the photon isn't accepting updates in this order
				// part1, part2, user
				// insert these new dependencies at the start of the array
				updates = resvArr.concat(updates);
			}
		}
		return updates;
	}

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

	/**
	 * go read in the file, parse the data for it, convert its precious
	 * contents to JSON.
	 *
	 * @returns `false` when the file doesn't exist
	 */
	async assimilateModule(filename: string): Promise<false | undefined> {
		if (!fs.existsSync(filename)) {
			return false;
		}

		this._moduleStorage ??= [];

		const parser = new HalModuleParser();
		try {
			const fileInfo = await parser.parseFile(filename);
			this._moduleStorage.push(Object.assign(fileInfo, { describe: this._binaryToDescribe(fileInfo.prefixInfo) }));
		} catch (error) {
			// oxlint-disable-next-line no-console
			console.error('assimilateModule err: ', error);
		}
	}

	/**
	 * expects the array of module descriptions back from the solve routine
	 * and returns amodule description result complete with fileBuffer
	 *
	 * @returns `null` when nothing was assimilated or `modules` is empty
	 */
	async retrieveModules(modules: ModuleRequirement[]): Promise<AssimilatedModule[] | null> {
		// expects that we've been given storage of all our available
		// modules, and their binary info.
		if (!this._moduleStorage) {
			return null;
		}

		if (!modules || modules.length <= 0) {
			return null;
		}

		const results: AssimilatedModule[] = [];

		// expecting something like...
		// { f: "s", n: "2", v: 2 }

		for (const m of modules) {
			const match = this._moduleStorage.find(
				({ describe: avail }) => avail && avail.n === m.n && avail.f === m.f && isVersionAtLeast(avail.v, m.v)
			);
			if (match) {
				results.push(match);
			}
		}
		return results;
	}

	/**
	 * given what modules are 'described' as being on a photon,
	 * and target binary info, figure out which modules need to be updated
	 * on that photon.
	 *
	 * @returns The modules to update
	 */
	solve(deviceModules: DescribeModule[], binaryInfo: PrefixInfo): ModuleRequirement[] {
		const safeDeviceModules = this._repairDescribeErrors(deviceModules);
		const safeBinaryRequires = this._binaryDepsToDescribe(binaryInfo);
		const safeBinaryRequires2 = this._binaryDepsToDescribe(binaryInfo, 2);

		const result = this._walkChain(safeDeviceModules, safeBinaryRequires);
		this._walkChain(safeDeviceModules, safeBinaryRequires2, result);
		return result;
	}

	/**
	 * given what modules are 'described' as being on a device,
	 * and known firmware module info, figure out which modules need
	 * to be updated on the device.
	 *
	 * @returns The modules to update
	 */
	solveFirmwareModule(deviceModules: DescribeModule[], firmwareModule: FirmwareModule): DescribeModule[] {
		const safeDeviceModules = this._repairDescribeErrors(deviceModules);
		const safeModuleRequires = firmwareModule.toDescribe();

		return this._walkChain(safeDeviceModules, safeModuleRequires);
	}

	/**
	 * given device's describe message figure out if it has
	 * missing modules. Rejected value contains missing
	 * dependencies
	 *
	 * @returns Rejects with a one-element `FirmwareModule[]` when a dependency is missing
	 */
	async userModuleHasMissingDependencies(describe: Describe): Promise<string> {
		if (!Array.isArray(describe.m)) {
			throw new Error('no modules in describe message');
		}

		const userModule = describe.m.findLast((m) => {
			const module = new FirmwareModule(m);
			return module.isUserModule() && module.isMainLocation();
		});

		if (!userModule) {
			return 'no user module';
		}

		for (const dep of userModule.d!) {
			const deps = this._walkChain(describe.m, dep);
			if (deps && deps.length > 0) {
				// this function only originally returned one dependency.
				throw [new FirmwareModule(deps[0])];
			}
		}

		return 'nothing missing';
	}

	/**
	 * tell us if anything with dependencies is missing something
	 *
	 * (this covers scenarios where user app needs something else, or user app has no deps, and part 1 is old, but
	 * part2 is current, etc.)  Built this because I hit this during testing.
	 *
	 * in what order should we apply updates?
	 * is it possible for us to get conflicting / out of order update recommendations?!
	 *
	 * @param options.includeFactoryFirmware When true, firmware at the factory location is included.
	 * @returns `undefined` when the describe message has no module list
	 */
	findAnyMissingDependencies(
		describe: Describe,
		options?: { includeFactoryFirmware?: boolean }
	): DescribeModule[] | undefined {
		if (!Array.isArray(describe.m)) {
			return;
		}

		const modules = describe.m;
		const allDeps = modules
			.filter((checkModule) => checkModule.l !== 'f' || options?.includeFactoryFirmware)
			// what things do we need that we don't have?
			.flatMap((checkModule) => checkModule.d!.flatMap((moduleNeeds) => this._walkChain(modules, moduleNeeds)));

		return utilities.dedupArray(allDeps, (dep) => [dep.f, dep.n, dep.v || ''].join('_'));
	}

	/**
	 * walk over the described modules until we've resolved our
	 * dependency chain for all the dependent things
	 * that need updating.
	 *
	 * (typically system module 1, and 2)
	 *
	 * @param modules what was in the describe message (the modules on the device)
	 * @param needs what was described in the binary header info - the dependencies being checked
	 * @param arr our accumulator array
	 */
	_walkChain<T extends ModuleRequirement>(
		modules: DescribeModule[],
		needs: T,
		arr: (T | DescribeModule)[] = []
	): (T | DescribeModule)[] {
		// Skip dependencies with function = "none"
		if (needs.f === ModuleInfo.FunctionChar.NONE) {
			return arr;
		}

		const foundModule = modules.find((m) => m.n === needs.n && m.f === needs.f);

		if (!foundModule) {
			// Module is not present in the list of modules on the device
			// Simply return the dependency as-is
			arr.push(needs);
		} else if (isVersionBelow(foundModule.v, needs.v)) {
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

			//arr.push(foundModule);

			// instead of returning the module we found, lets return the module with the version we need,
			// _and cleared dependencies_, as we have no idea what that module actually might require.
			// In previous versions, we used to return dependencies of the old module.
			const missing = { ...foundModule, v: needs.v, d: [] };
			arr.push(missing);

			// if we're updating this, we better check its dependencies too.
			if (foundModule.d && foundModule.d.length > 0) {
				//oh no!  this module has dependencies!
				// do we have to update those too?
				// (this doesn't fully make sense to me right now, but lets go with it.)
				// todo mdm - this won't do anything, since `m` is always a satisfied dependency
				// (it came from the modules array.)
				// at the very least we should be iterating over foundModule.d[] as the needed modules
				arr = this._walkChain<T | DescribeModule>(modules, foundModule, arr);
			}
		}

		return arr;
	}

	/**
	 * for modules in 'location:main'
	 * not for user modules 'function:user'
	 *
	 * for modules with 'function:system' or 'function:bootloader'
	 *
	 * fix the array so that 'n' is ascending '0', '1', '2' ...
	 * set any missing version to 'version:0'
	 * set missing function to 'function:system'
	 *
	 * Modifies `describeInfo` in place and returns it.
	 */
	_repairDescribeErrors(describeInfo: DescribeModule[]): DescribeModule[] {
		const arr = describeInfo;

		// we're assuming the modules are in the reported order,
		// which should be dependency order.

		// essentially we're looking to add this to the correct module:
		//	f: 's', n: '1', v: 1,

		for (const [i, item] of arr.entries()) {
			if (item.l !== 'm') {
				//not stored in main
				continue;
			} else if (item.f === 'u') {
				//I'm a user module, bail
				break;
			}

			// are we the first thing and we don't have a name?
			if (i === 0 && !item.n) {
				item.n = i + '';
			}

			//skip the first one.
			if (i === 0) {
				continue;
			}

			// i is at least 1
			const lastItem = arr[i - 1];

			if (lastItem?.n && !item.n) {
				//last one had a name, and I don't have a name.
				item.n = Number.parseInt(lastItem.n) + 1 + '';

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
	}

	/**
	 * the binary prefix contains a numeric value for its dependent
	 * module function convert that number into the same characters
	 * reported by the photon (s, u, b, etc)
	 *
	 * @returns `null` for `NONE`
	 */
	_modFuncToChar(moduleFunction: number): string | null {
		switch (moduleFunction) {
			case 0:
				return null;
			case 1:
				return '1_unknown';
			case 2:
				return 'b';
			case 3:
				return '3_unknown';
			case 4:
				return 's';
			case 5:
				return 'u';
			default:
				return 'undefined';
		}
	}

	/**
	 * convert the 'dependency' keys from the binary prefix info into
	 * the common JSON
	 * format used by the describe messages.
	 *
	 * @param dep Which dependency to convert: 1 (the default) or 2
	 */
	_binaryDepsToDescribe(binaryInfo?: Partial<PrefixInfo> | null, dep = 1): BinaryModule {
		if (!binaryInfo || (dep !== 2 && dep > 1)) {
			return {};
		}
		const prefix = dep === 2 ? 'dep2' : 'dep';
		return toBinaryModule(
			binaryInfo[`${prefix}ModuleFunction`],
			binaryInfo[`${prefix}ModuleIndex`],
			binaryInfo[`${prefix}ModuleVersion`],
			this
		);
	}

	/**
	 * convert the binary function/name/index/version keys from the binary
	 * prefix info into the common JSON format used by the describe messages.
	 *
	 * NOTE: this is separate so as to not conflict with the dependency
	 * conversion above.
	 */
	_binaryToDescribe(binaryInfo?: Partial<PrefixInfo> | null): BinaryModule | null {
		if (!binaryInfo) {
			return null;
		}
		return toBinaryModule(binaryInfo.moduleFunction, binaryInfo.moduleIndex, binaryInfo.moduleVersion, this);
	}
}

function toBinaryModule(
	func: number | undefined,
	index: number | undefined,
	version: number | undefined,
	resolver: HalDependencyResolver
): BinaryModule {
	const result: BinaryModule = {};
	if (func !== undefined) {
		result.f = resolver._modFuncToChar(func);
	}
	if (index !== undefined) {
		result.n = index + '';
	}
	if (version !== undefined) {
		result.v = version;
	}
	return result;
}

function isVersionBelow(version: number | undefined, required: number | undefined): boolean {
	return version !== undefined && required !== undefined && version < required;
}

function isVersionAtLeast(version: number | undefined, required: number | undefined): boolean {
	return version !== undefined && required !== undefined && version >= required;
}

/** A module read from a binary's prefix, in the describe message format. `f` is `null` for module function `NONE`. */
export interface BinaryModule {
	f?: string | null;
	n?: string;
	v?: number;
}

/** A module from a describe message or a binary's prefix. */
export type ModuleRequirement = DescribeModule | BinaryModule;

/** A module loaded with `assimilateModule()`. */
export type AssimilatedModule = FileInfo & { describe: BinaryModule | null };
