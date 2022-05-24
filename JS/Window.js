// Imported Libraries

// OPO/A is controlled through TCP communication, which is done through JS module Net
const net = require("net");
const fs = require("fs");
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
function wavelength_measure(wavelength_amount) {
    if (opo_status.motors_moving) {
        // Motors are still moving, don't measure
        return;
    }
    let wl_amount = wavelength_amount || 3;
    let wavelengths = [];
    let wavelength_count = 0;
    wavelength_loop(wavelengths, wavelength_count, wl_amount);
}

// Loop function for previous function
function wavelength_loop(wavelengths, wavelength_count, wavelength_amount) {
    if (wavelength_count >= wavelength_amount) {
        write_array(wavelengths);
        let average_results = get_average(wavelengths);
        let average = average_results[0];
        let stdev = average_results[1];
        let stdev_cm = get_del_nu(average, stdev);
        console.log("Wavelength measurement:", average, stdev, wavelengths.length);
        console.log("Error in cm-1", stdev_cm);
        average_results = get_reduced_average(wavelengths);
        average = average_results[0];
        stdev = average_results[1];
        stdev_cm = get_del_nu(average, stdev);
        console.log("Wavelength measurement after reduction:", average, stdev, average_results[2].length);
        console.log("Error in cm-1", stdev_cm);
        if (Math.abs(stdev_cm) < 0.1) {
            update_ir_wavelength(average);
        } else {
            console.log("Standard deviation too high");
        }
    } else {
        setTimeout(() => {
            let wl = wavemeter.getWavelength();
            // Check that the wavelength is not an error code
            if (wl > 0) {
                /*if (opo_status.current_wl - 0.025 < wl && wl < opo_status.current_wl + 0.025) {
                    wavelengths.push(wl);
                    wavelength_count++;
                }*/
                wavelengths.push(wl);
                wavelength_count++;
            }
            wavelength_loop(wavelengths, wavelength_count, wavelength_amount);
        }, 400 /* ms */);
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

// Get average and filter out outliers until a value is converged upon
function get_reduced_average(array) {
    let avg_results;
    let avg;
    let stdev = 100;
    while (true) {
        avg_results = get_average(array);
        avg = avg_results[0];
        stdev = avg_results[1];
        if (array.length < 5 || stdev < 0.001) {
            return [avg, stdev, array];
        }
        array = array.filter(value => (avg - stdev < value && value < avg + stdev));
    }
}

// Get error in wavenumbers for nIR
// del_iIR, del_mIR = del_nIR
// del_fIR = 2 del_nIR
function get_del_nu(wavelength, stdev) {
    return - (Math.pow(10, 7) * stdev) / (Math.pow(wavelength, 2) + wavelength * stdev);
}



/* Functions for OPO */

const opo_client = new net.Socket();

const opo_status = {
    motors_moving: false,
    current_wl: 0,
}

const opo_config = {
    host: "169.254.170.155",
    port: 1315
};

const opo_cmd = {
    get_wl: "TELLWL",
    get_motor_status: "TELLSTAT",
    move: (val) => {return "GOTO " + val.toFixed(3)}, 
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
    // Make sure wavelength is in proper OPO bounds
    const lower_wl_bound = 710;
    const upper_wl_bound = 880;
    if (wl < lower_wl_bound || wl > upper_wl_bound) {
        console.log(`Wavelength ${wl} nm is out of OPO bounds: ${lower_wl_bound} - ${upper_wl_bound}`);
        return;
    }
    opo_status.motors_moving = true;
    opo_client.write(opo_cmd.move(wl), () => {});
    console.time("Change WL");
    when_motor_stopped();
}

function when_motor_stopped() {
    if (opo_status.motors_moving) {
        setTimeout(() => {
            get_motor_status();
            when_motor_stopped();
        }, 100);
    } else {
        console.log("Motors done moving!");
        console.timeEnd("Change WL");
        // Measure the wavelength
        wavelength_measure(50);
    }
}

opo_client.on("data", (data) => {
    // Convert to string
    data = data.toString();
    // Get rid of newline character "/r/n"
    data = data.replace("\r\n", "");
    // Filter motor movement results, which are hexadecimal numbers
    if (data.startsWith("0x")) {
        // Note: Don't use triple equals here
        if (data == 0) {
            // Motors are done moving
            opo_status.motors_moving = false;
            return;
        }
        // Motors are still moving
        opo_status.motors_moving = true;
        return;
    }
    // Convert data to number
    data = parseFloat(data);
    // Check if it's an error code
    if (data < 10) {
        parse_opo_error(data);
        return;
    }
    // Only remaining option is it's the OPO's wavelength
    update_opo_wavelength(data);
});

// Parse OPO error
function parse_opo_error(error_code) {
    if (!error_code) {
        // No error code or error_code === 0 => Successfully executed command
        return;
    }
    const opo_errors = [
        "Successfully Executed Command",
        "Invalid Command",
        "Required Window Not Open",
        "Specified Value Is Out Of Range",
        "Specified Velocity Is Out Of Safe Values",
        "A GoTo Operation Is Already Active",
        "Unable To Change Settings While Motor Movement Active",
        "No USB Voltmeter Detected"
    ];
    // Print the error to console
    console.log("OPO Error: " + opo_errors[error_code]);
}

// Update nIR wavelength value given by OPO
function update_opo_wavelength(wavelength) {
    console.log("Wavelength:", wavelength);
    opo_status.current_wl = wavelength;
}

/* Functions for Wavelength Conversion */

function update_ir_wavelength(wavelength) {
    // Make sure it's a true value (i.e. within bounds of nIR)
    if (wavelength < laser.excitation.control.nir_lower_bound || wavelength > laser.excitation.control.nir_upper_bound) {
        return;
    }
    laser.excitation.wavelength.input = wavelength;
    laser.excitation.convert();
}

// Process and track info relating to lasers
const laser = {
	excitation: {
		mode: "nir", // Can be "nir", "iir", "mir", or "fir"
		wavelength: {
			yag_fundamental: 1064.5, // Nd:YAG fundamental wavelength
			input: 0, // User entered (or measured) wavelength
			nir: 0,
			iir: 0,
			mir: 0,
			fir: 0,
		},
		wavenumber: {
			yag_fundamental: 0, // Nd:YAG fundamental wavelength
			nir: 0,
			iir: 0,
			mir: 0,
			fir: 0,
		},
		control: {
			nir_lower_bound: 710,
			nir_upper_bound: 880,
			current_nir_motor: 0,
			desired_ir: 0, // In cm^-1
            desired_ir_mode: "nir",
            desired_nir: 0, // In nm
            /**
             * Move the OPO/A to the desired photon energy (cm^-1)
             * @param {number} wavenumber - Value in cm^-1 to move OPO/A to
             * @param {boolean} use_nm - If true, wavenumber should be given as a wavelength in nm
             */
            goto: (wavenumber, use_nm) => laser_excitation_control_goto(wavenumber, use_nm),
		},
		/**
		 * Convert OPO/A laser energies
		 */
		convert: () => laser_excitation_convert(),
	},
	/**
	 * Convert between wavelength (nm) and wavenumbers (cm^-1)
	 * @param {number} energy - Energy to convert
	 * @returns Converted energy
	 */
	convert_wn_wl: function (energy) {
		if (!energy) {
			// Energy is 0 or undefined
			return 0;
		}
		return Math.pow(10, 7) / energy;
	},
};

/*
	Specific functions used for laser
*/

// Convert OPO/A laser energies
function laser_excitation_convert() {
	let input_wl = laser.excitation.wavelength.input; // Input energy (nm)
	let input_wn = decimal_round(laser.convert_wn_wl(input_wl), 3); // Input energy (cm^-1)
	let yag_wl = laser.excitation.wavelength.yag_fundamental; // YAG fundamental (nm)
	let yag_wn = decimal_round(laser.convert_wn_wl(yag_wl), 3); // YAG fundamental (cm^-1)
	// Make sure YAG fundamental in cm^-1 is defined
	laser.excitation.wavenumber.yag_fundamental = yag_wn;
	// Near-IR, will be the same as input value
	laser.excitation.wavelength.nir = input_wl;
	laser.excitation.wavenumber.nir = input_wn;
	// Intermediate-IR, 2 * YAG - nIR (cm^-1)
	let iir_wn = 2 * yag_wn - input_wn; // iIR (cm^-1)
	let iir_wl = laser.convert_wn_wl(iir_wn); // iIR (nm)
	laser.excitation.wavelength.iir = decimal_round(iir_wl, 3);
	laser.excitation.wavenumber.iir = decimal_round(iir_wn, 3);
	// Mid-IR, YAG - iIR (cm^-1)
	let mir_wn = yag_wn - iir_wn; // mIR (cm^-1)
	let mir_wl = laser.convert_wn_wl(mir_wn); // mIR (nm)
	laser.excitation.wavelength.mir = decimal_round(mir_wl, 3);
	laser.excitation.wavenumber.mir = decimal_round(mir_wn, 3);
	// Far-IR, iIR - mIR (cm^-1)
	let fir_wn = iir_wn - mir_wn; // fIR (cm^-1)
	let fir_wl = laser.convert_wn_wl(fir_wn); // fIR (nm)
	laser.excitation.wavelength.fir = decimal_round(fir_wl, 3);
	laser.excitation.wavenumber.fir = decimal_round(fir_wn, 3);
}

// Move OPO/A to specific laser energy (in cm^-1)
function laser_excitation_control_goto(wavenumber, use_nm) {
    let nir_wl;
    let nir_wn;
    let desired_mode;
    let yag_wl = laser.excitation.wavelength.yag_fundamental; // YAG fundamental (nm)
	let yag_wn = decimal_round(laser.convert_wn_wl(yag_wl), 3); // YAG fundamental (cm^-1)
    if (use_nm) {
        wavenumber = laser.convert_wn_wl(wavenumber);
    }
    // Figure out which energy regime wavenumber is in
    if (11355 < wavenumber && wavenumber < 14080) {
        // Near IR
        desired_mode = "nir";
        nir_wl = decimal_round(laser.convert_wn_wl(wavenumber), 4);
    } else if (4500 < wavenumber && wavenumber < 7400) {
        // Intermediate IR
        desired_mode = "iir";
        nir_wn = 2 * yag_wn - wavenumber;
        nir_wl = decimal_round(laser.convert_wn_wl(nir_wn), 4);
    } else if (2000 < wavenumber && wavenumber < 4500) {
        // Mid IR
        desired_mode = "mir";
        nir_wn = yag_wn + wavenumber;
        nir_wl = decimal_round(laser.convert_wn_wl(nir_wn), 4);
    } else if (625 < wavenumber && wavenumber < 2000) {
        // Far IR
        desired_mode = "fir";
        nir_wn = (3 * yag_wn - wavenumber) / 2;
        nir_wl = decimal_round(laser.convert_wn_wl(nir_wn), 4);
    } else {
        // Photon energy out of range
        console.log("OPO GOTO: Wavelength Out of Range");
        return;
    }
    // Update values
    laser.excitation.control.desired_ir_mode = desired_mode;
    laser.excitation.mode = desired_mode;
    laser.excitation.control.desired_ir = wavenumber;
    laser.excitation.control.desired_nir = nir_wl;
    // Tell OPO to move to that wavelength
    console.log(`Detected IR mode: ${desired_mode}`);
    console.log(`Going to Wavelength: ${nir_wl} nm to get hv: ${wavenumber} cm^-1`);
    go_to_wl(nir_wl);
}



/* Random Functions */

/**
 * Round value to specified decimal place
 * @param {number} num - value to round
 * @param {number} d - number of decimal places (default is 3)
 * @returns {number} rounded value
 */
 function decimal_round(num, d) {
	let d_val = d || 3;
	let decimal_val = Math.pow(10, d_val);
	// Adding Number.EPSILON prevents floating point errors
	return Math.round((num + Number.EPSILON) * decimal_val) / decimal_val;
}

function write_array(array) {
    let str = "";
    for (let i = 0; i < array.length - 1; i++) {
        str += array[i].toFixed(5) + "\n";
    }
    str += array[array.length - 1].toFixed(5);
    fs.writeFile("./wavelength_measurements.txt", str, () => {});
}