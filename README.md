# The Particle Binary Version Reader!

If you're building firmware on the Particle Platform, you might be curious to see the metadata stored in your firmware!  This module will read any metadata stored in the various modules (bootloader, system, user), and help you understand any dependencies.

[![Build Status](https://github.com/particle-iot/binary-version-reader/actions/workflows/ci.yaml/badge.svg)](https://github.com/particle-iot/binary-version-reader/actions)



## Usage

```js
    const Reader = require('binary-version-reader').HalModuleParser;
    const reader = new Reader();
    reader.parseFile('your_binary.bin', function(fileInfo, err) {
        console.log(fileInfo);
    });
```

You can also get the raw output of binary-version-reader by using it as a command line tool without installing it.

```
npx binary-version-reader your_binary.bin
```

## Example output

```json
{
	"filename": "/.../040_user-part.bin",
	"fileBuffer": "<Buffer ...>",
	"crc": {
		"ok": 1,
		"storedCrc": "b138f375",
		"actualCrc": "b138f375"
	},
	"prefixInfo": {
		"moduleStartAddy": "80a0000",
		"moduleEndAddy": "80a128c",
		"moduleVersion": 2,
		"platformID": 6,
		"moduleFunction": 5,
		"moduleIndex": 1,
		"depModuleFunction": 4,
		"depModuleIndex": 2,
		"depModuleVersion": 1
	},
	"suffixInfo": {
		"productId": -1,
		"productVersion": -1,
		"fwUniqueId": "f9f552aa98d7e3eab750862a01743024a4d05514021598a4341b3d83b37eda36",
		"reserved": 0,
		"suffixSize": 36,
		"crcBlock": "b138f375"
	}
}
```


## Testing firmware binaries

When you need to create a firmware binary for an integration test, you
can use the provided `firmwareTestHelper` instead of relying on fixtures
in your application.

```
const { firmwareTestHelper, ModuleInfo } = require('binary-version-reader');
const binary = firmwareTestHelper.createFirmwareBinary({ productId: 123, productVersion: 6, platformId: 10, deps: [ { func: ModuleInfo.FunctionType.SYSTEM_PART, index: 1, version: 1210 } ] });
```

## Releasing changes

Packages are only released from the `master` branch after peer review.

1. make sure you have the latest:
	* `$ git checkout master`
	* `$ git pull`
2. make sure tests pass
	* `$ npm test`
3. bump the version
	* `$ npm version <major|minor|patch>`
4. push your tags:
	* `$ git push origin main --follow-tags`
