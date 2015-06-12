The Particle Binary Version Reader!
=====

If you're building firmware on the Particle Platform, you might be curious to see the metadata stored in your firmware!  This module will read any metadata stored in the various modules (bootloader, system, user), and help you understand any dependencies.

Usage
===

var Reader = require('binary-version-reader');

```
    var reader = new Reader();
    reader.parseFile('your_binary.bin', function(fileInfo, err) {
        console.log(fileInfo);
    });
```