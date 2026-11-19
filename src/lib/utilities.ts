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
import { globalConfig } from './config';

/**
 * Keeps the first item for each key.
 *
 * @param keyFn When not given, `arr` is returned as-is
 */
export function dedupArray<T>(arr: T[], keyFn?: (item: T) => string): T[] {
	if (!keyFn) {
		return arr;
	}

	const seen = new Set<string>();
	return arr.filter((item) => {
		const key = keyFn(item);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

/** Computes a CRC-32 with the function set by `config()`. */
export function crc32(buf: Buffer): Buffer {
	return globalConfig.crc32(buf);
}
