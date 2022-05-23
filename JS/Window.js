// Imported Libraries

// OPO/A is controlled through TCP communication, which is done through JS module Net
const net = require("net");
// Wavemeter is controlled through C++, which requires node addons
const wavemeter = require("bindings")("wavemeter");

window.onload = function () {
    startup();
}

function startup() {
    init_opo();
}

/* Functions for wavemeter */

// Get 10 measurements of laser wavelength and print
function wavelength_measure() {
    console.time("wavelength_measure");
    let wavelengths = [];
    let wavelength_count = 0;
    wavelength_loop(wavelengths, wavelength_count);
}

// Loop function for previous function
function wavelength_loop(wavelengths, wavelength_count) {
    if (wavelength_count >= 3) {
        let average_results = get_average(wavelengths);
        let average = average_results[0];
        let stdev = average_results[1];
        console.log("Wavelength measurement:", average, stdev, wavelengths);
        console.log("Error in cm-1", get_del_nu(average, stdev));
        console.timeEnd("wavelength_measure");
    } else {
        setTimeout(() => {
            let wl = wavemeter.getWavelength();
            wavelengths.push(wl);
            wavelength_count++;
            wavelength_loop(wavelengths, wavelength_count);
        }, 100 /* ms */);
    }
}

// Get average and variation of an array
function get_average(array) {
    const len = array.length;
    const sum = array.reduce((accumulator, current_value) => {
        return accumulator + current_value;
    });
    let avg = sum / len;
    let stdev = Math.sqrt(array.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b) / len);
    return [avg, stdev];
}

// Get error in wavenumbers for nIR
// del_iIR, del_mIR = del_nIR
// del_fIR = 2 del_nIR
function get_del_nu(wavelength, stdev) {
    return - (Math.pow(10, 7) * stdev) / (Math.pow(wavelength, 2) + wavelength * stdev);
}



/* Functions for OPO */

const opo_client = new net.Socket();

const opo_config = {
    host: "169.254.170.155",
    port: 1315
};

const opo_cmd = {
    get_wl: "TELLWL",
    get_motor_status: "TELLSTAT",
    move: (val) => {return "GOTO" + val.toFixed(3)}, 
};

function init_opo() {
    opo_client.connect(opo_config, () => {});
}

function close_opo() {
    opo_client.end();
}

function get_opo_wavelength() {
    opo_client.write(opo_cmd.get_wl, () => {});
}

function get_motor_status() {
    opo_client.write(opo_cmd.get_motor_status, () => {});
}

function go_to_wl(wl) {
    opo_client.write(opo_cmd.move(wl), () => {});
}

opo_client.on("data", (data) => {
    // Convert to string
    data = data.toString();
    // Get rid of newline character "/r/n"
    data = data.replace("\r\n", "");
    // Filter motor movements
    if (data === "0x0") {
        console.log(data);
        console.log("Motor done moving");
    } else {
        console.log("Wavelength:", data);
    }
})