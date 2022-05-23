// Imported Libraries

// OPO/A is controlled through TCP communication, which is done through JS module Net
const net = require("net");
// Wavemeter is controlled through C++, which requires node addons
const wavemeter = require("bindings")("wavemeter");