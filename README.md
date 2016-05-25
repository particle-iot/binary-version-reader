The Particle Binary Version Reader!
=====

If you're building firmware on the Particle Platform, you might be curious to see the metadata stored in your firmware!  This module will read any metadata stored in the various modules (bootloader, system, user), and help you understand any dependencies.

[![Build Status](https://travis-ci.org/spark/binary-version-reader.svg?branch=master)](https://travis-ci.org/spark/binary-version-reader)


Usage
===

```
    var Reader = require('binary-version-reader').HalModuleParser;
    var reader = new Reader();
    reader.parseFile('your_binary.bin', function(fileInfo, err) {
        console.log(fileInfo);
    });
```

Example output
===

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


## Known issues

* missing better documentation / examples
* tests for newer platforms as they become available
