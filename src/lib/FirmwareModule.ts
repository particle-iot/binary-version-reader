import { HalDependencyResolver } from './HalDependencyResolver';
import * as ModuleInfo from './ModuleInfo';

/**
 * Extracts the short names from a module descriptor and turns them into more readable names.
 */
export class FirmwareModule {
	dependencies: FirmwareModule[];
	// `declare` emits no class field, so these properties only exist on instances built from a describe message
	declare uuid?: string;
	declare func?: string;
	declare location?: string;
	declare name?: string;
	declare version?: number;
	declare maxSize?: number;
	declare validityCheck?: number;
	declare validityValues?: number;

	constructor(describeMessage?: DescribeModule | null) {
		this.dependencies = Array.isArray(describeMessage?.d) ? describeMessage.d.map((d) => new FirmwareModule(d)) : [];

		if (describeMessage) {
			// https://github.com/particle-iot/firmware-private/wiki/updating-system-firmware#describe-message-extension
			this.uuid = describeMessage.u;
			this.func = describeMessage.f;
			this.location = describeMessage.l;
			this.name = describeMessage.n;
			this.version = describeMessage.v;
			this.maxSize = describeMessage.s;
			this.validityCheck = describeMessage.vc;
			this.validityValues = describeMessage.vv;
		}
	}

	/** Module function characters indexed by `ModuleInfo.FunctionType` */
	get moduleFunctions() {
		return ModuleInfo.FunctionToChar;
	}

	isValid(): boolean {
		return this.validityValues === this.validityCheck;
	}

	hasIntegrity(): boolean {
		return hasValidationFlag(this, ModuleInfo.ValidationFlags.INTEGRITY);
	}

	areDependenciesValid(): boolean {
		return hasValidationFlag(this, ModuleInfo.ValidationFlags.DEPENDENCIES);
	}

	isImageAddressInRange(): boolean {
		return hasValidationFlag(this, ModuleInfo.ValidationFlags.RANGE);
	}

	isImagePlatformValid(): boolean {
		return hasValidationFlag(this, ModuleInfo.ValidationFlags.PLATFORM);
	}

	isImageProductValid(): boolean {
		return hasValidationFlag(this, ModuleInfo.ValidationFlags.PRODUCT);
	}

	isUserModule(): boolean {
		return this.func === 'u';
	}

	isSystemModule(): boolean {
		return this.func === 's';
	}

	isMainLocation(): boolean {
		return this.location === 'm';
	}

	isFactoryLocation(): boolean {
		return this.location === 'f';
	}

	/** Converts this module and its dependencies back to the describe message format. */
	toDescribe(): DescribeModule {
		return {
			u: this.uuid,
			f: this.func,
			l: this.location,
			n: this.name,
			v: this.version,
			s: this.maxSize,
			vc: this.validityCheck,
			vv: this.validityValues,
			d: this.dependencies.map((m) => m.toDescribe())
		};
	}

	/**
	 * @param deviceModules The modules on the device (`describe.m`)
	 * @param invalidModules Receives the dependencies that are missing or out of date
	 */
	areDependenciesMet(deviceModules: DescribeModule[], invalidModules: FirmwareModule[] = []): boolean {
		if (!deviceModules) {
			return false;
		}

		if (this.dependencies.length === 0) {
			return true;
		}

		const resolver = new HalDependencyResolver();

		for (const dep of this.dependencies) {
			const invalidDependencyModules = resolver.solveFirmwareModule(deviceModules, dep);
			invalidModules.push(...invalidDependencyModules.map((m) => new FirmwareModule(m)));
		}
		return invalidModules.length === 0;
	}
}

function hasValidationFlag(module: FirmwareModule, flag: number): boolean {
	return !!((module.validityValues ?? 0) & flag);
}

/** One module as reported in a device's describe message (`describe.m`), or one of its dependencies (`d`). */
export interface DescribeModule {
	/** UUID (hex-encoded SHA-256 of the module) */
	u?: string;
	/** Module function as a `ModuleInfo.FunctionChar`, e.g. `'s'` for a system part */
	f?: string;
	/** Location: `'m'` (main) or `'f'` (factory) */
	l?: string;
	/** Module index as a string, e.g. `'1'` */
	n?: string;
	/** Module version */
	v?: number;
	/** Maximum module size in bytes */
	s?: number;
	/** Validity checks performed, as `ModuleInfo.ValidationFlags` */
	vc?: number;
	/** Validity checks passed, as `ModuleInfo.ValidationFlags` */
	vv?: number;
	/** Dependencies */
	d?: DescribeModule[];
}
