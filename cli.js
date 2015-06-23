/**
 * Created by middleca on 6/23/15.
 */

var HalModuleParser = require('./lib/HalModuleParser.js');
var p = new HalModuleParser();


var args = process.argv;
if (args.length <= 2) {
	console.log("no filename specified");
	process.exit(-1);
}
var filename = process.argv[2];


p.parseFile(filename, function() {
	console.log("got ", arguments);
});