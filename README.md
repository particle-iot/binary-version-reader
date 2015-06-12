The Particle Binary Version Reader!
=====

If you're building firmware on the Particle Platform, you might be curious to see the metadata stored in your firmware!  This module will read any metadata stored in the various modules (bootloader, system, user), and help you understand any dependencies.

Usage
===

Something like... 

```
    var Reader = require('binary-version-reader');
    var reader = new Reader();
    reader.parseFile('your_binary.bin', function(fileInfo, err) {
        console.log(fileInfo);
    });
```

```json
#potential output
{
	filename: '/.../040_user-part.bin',
	fileBuffer: <Buffer ...>,
	crc: {
		ok: 1, storedCrc: 'b138f375', actualCrc: 'b138f375'
	},
	prefixInfo: {
		moduleStartAddy: '80a0000',
		moduleEndAddy: '80a128c',
		moduleVersion: 2,
		platformID: 6,
		moduleFunction: 5,
		moduleIndex: 1,
		depModuleFunction: 4,
		depModuleIndex: 2,
		depModuleVersion: 1
	},
	suffixInfo: {
		product_id: -1,
		product_version: -1,
		fw_unique_id: 'f9f552aa98d7e3eab750862a01743024a4d05514021598a4341b3d83b37eda36',
		reserved: 0,
		suffixSize: 36,
		crcBlock: 'b138f375'
	}
}```