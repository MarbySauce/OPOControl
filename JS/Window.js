// Imported Libraries

// OPO/A is controlled through TCP communication, which is done through JS module Net
const net = require("net");
const fs = require("fs");
const { performance } = require("perf_hooks");
// Wavemeter is controlled through C++, which requires node addons
const wavemeter = require("bindings")("wavemeter");

window.onload = function () {
    startup();
}

function startup() {
    laser.excitation.mode = 'mir';
    init_opo();
}

/* Functions for wavemeter */

const wavelengths = {
    values: [],
    results: {
        average: 0,
        stdev: 0,
        reduced_average: 0,
        reduced_stdev: 0,
        reduced_values: [],
    },
    status: {
        measuring: true, // Whether a measurement is being taken
    },
    params: {
        average_length: 10,
        default_average_length: 10,
        reducing_threshold: 0.01, // nm
        measurement_delay: 100, // ms
        max_iterations: 10,
        should_reduce: true,
        should_save: false,
        show_results: true,
        save_loc: "./wavelength_measurements/wavelength_measurements.txt",
    },
    counts: {
        values: 0,
        failures: 0,
        iterations: 0,
    },
    timing: {
        start_time: 0,
        end_time: 0,
        elapsed_time: 0,
        start: () => wavelengths_timing_start(),
        end: () => wavelengths_timing_end(),
    },
    timeout: undefined,
    measure: (length, should_save) => wavelengths_measure(length, should_save),
    cancel: () => wavelengths_cancel(),
    save: () => wavelengths_save(),
    loop: () => wavelengths_loop(),
    process: () => wavelengths_process(),
    update_ir_wavelength: () => wavelengths_update_ir_wavelength(),
    average: (return_values, wavelength_values) => wavelengths_average(return_values, wavelength_values),
    reduced_average: () => wavelengths_reduced_average(),
    reset: () => wavelengths_reset(),
}

/* Wavelengths function definitions */

// Get series of wavelength measurements to average
function wavelengths_measure(length, should_save) {
    if (opo_status.motors_moving) {
        // Motors are still moving, don't measure
        console.log("Motors are still moving...");
        return;
    }
    if (length > 0) {
        wavelengths.params.average_length = length;
    } else {
        // Use default value
        wavelengths.params.average_length = wavelengths.params.default_average_length;
    }
    if (should_save || should_save === false) {
        wavelengths.params.should_save = should_save;
    }
    console.log("------------------------------------------------------")
    console.log("Starting wavelength measurement!")
    // Reset counters and value array
    wavelengths.reset();
    // Start loop
    wavelengths.status.measuring = true;
    wavelengths.timing.start();
    wavelengths.loop();
}

// Cancel a measurement if currently being taken
function wavelengths_cancel() {
    if (!wavelengths.status.measuring || !wavelengths.timeout) {
        // No current measurement, return
        return;
    }
    // Cancel the timeout
    clearTimeout(wavelengths.timeout);
    wavelengths.timing.end();
    wavelengths.status.measuring = false;
    console.log("Measurement canceled");
}

// Save wavelength measurements to file
function wavelengths_save() {
    fs.writeFile(wavelengths.params.save_loc, wavelengths.values.join("\n"), () => {});
    // Don't automatically save future measurements
    wavelengths.params.should_save = false;
}

// Repeatedly measure wavelength
function wavelengths_loop() {
    if (wavelengths.counts.failures > 0.2 * wavelengths.params.average_length) {
        // Too many failed measurements, cancel measurement
        console.log(`Wavelength loop: ${wavelengths.counts.failures} failed measurements - Canceled`);
        wavelengths.timing.end();
        wavelengths.status.measuring = false;
        return;
    }
    if (wavelengths.counts.values >= wavelengths.params.average_length) {
        // Enough wavelengths have been measured, execute post-measurement processing
        wavelengths.timing.end();
        wavelengths.status.measuring = false;
        wavelengths.process();
    } else {
        // Set timout to measure another wavelength after given delay
        wavelengths.timeout = setTimeout(() => {
            let wl = wavemeter.getWavelength();
            if (wl > 0) {
                // Make sure we didn't get the same measurement twice by comparing against last measurement
                if (wl !== wavelengths.values.at(-1)) {
                    wavelengths.values.push(wl);
                    wavelengths.counts.values++;
                }
            } else {
                // Wavelength was not measured, uptick failure count
                wavelengths.counts.failures++;
            }
            // Re-execute the loop
            wavelengths.loop();
        }, wavelengths.params.measurement_delay);
    }
}

// Process wavelength values after measurement is completed
function wavelengths_process() {
    // Save values if requested
    if (wavelengths.params.should_save) {
        wavelengths.save();
    }
    // Calculate average values and standard deviation
    wavelengths.average();
    // Calculate reduced average, stdev values if requested
    if (wavelengths.params.should_reduce) {
        wavelengths.reduced_average();
    }
    // Update laser energies with new measurement
    wavelengths.update_ir_wavelength();
    // Print results if requested
    if (wavelengths.params.show_results) {
        console.log(`Measured wavelength ${wavelengths.results.average.toFixed(4)} nm with ${wavelengths.results.stdev.toFixed(6)} nm variation`);
        if (wavelengths.params.should_reduce && wavelengths.counts.iterations > 0) {
            console.log(`After reducing to ${wavelengths.results.reduced_values.length} values, wavelength is ${wavelengths.results.reduced_average.toFixed(4)} nm with ${wavelengths.results.reduced_stdev.toFixed(6)} nm variation`);
            console.log(`OPO Controller wavelength: ${opo_status.current_wl} nm; Difference (actual - controller) = ${(wavelengths.results.reduced_average - opo_status.current_wl).toFixed(4)} nm`);
        } else {
            console.log(`OPO Controller wavelength: ${opo_status.current_wl} nm; Difference (actual - controller) = ${(wavelengths.results.average - opo_status.current_wl).toFixed(4)} nm`);
        }
        console.log(`${laser.excitation.mode} energy is ${laser.excitation.wavenumber[laser.excitation.mode]} cm^-1`);
    }
}

// Update the IR wavelength in laser information
function wavelengths_update_ir_wavelength() {
    let wavelength;
    // Check if we should use reduced average value
    if (wavelengths.params.should_reduce) {
        wavelength = wavelengths.results.reduced_average;
    } else {
        wavelength = wavelengths.results.average;
    }
    // Make sure it's within bounds of nIR
    if (wavelength < laser.excitation.control.nir_lower_bound || wavelength > laser.excitation.control.nir_upper_bound) {
        return;
    }
    laser.excitation.wavelength.input = wavelength;
    laser.excitation.convert();
}


// Calculate average value and standard deviation of wavelength measurements
function wavelengths_average(return_values, wavelength_values) {
    if (!wavelength_values) {
        wavelength_values = wavelengths.values;
    }
    const len = wavelength_values.length;
    const sum = wavelength_values.reduce((accumulator, current_value) => {
        return accumulator + current_value;
    });
    let average = sum / len;
    let stdev = Math.sqrt(wavelength_values.map(x => Math.pow(x - average, 2)).reduce((a, b) => a + b) / len);
    if (return_values) {
        return [average, stdev];
    }
    // return_values is false (or null), save values
    wavelengths.results.average = average;
    wavelengths.results.stdev = stdev;
}

// Calculate average and filter outliers until standard deviation is small enough
function wavelengths_reduced_average() {
    let average; let stdev;
    // Copy values into new array to reduce
    let values = [...wavelengths.values];
    while (true) {
        [average, stdev] = wavelengths.average(true, values); // Get average and return values (not save)
        if (values.length < 5 || stdev < wavelengths.params.reducing_threshold || wavelengths.counts.iterations >= wavelengths.params.max_iterations) {
            wavelengths.results.reduced_average = average;
            wavelengths.results.reduced_stdev = stdev;
            wavelengths.results.reduced_values = values;
            console.log(`Reduced Average iterations: ${wavelengths.counts.iterations}`);
            return;
        }
        // Filter out wavelengths more than 1 stdev away from average
        values = values.filter(wl => (average - stdev < wl && wl < average + stdev));
        // Uptick reduction iteration counter
        wavelengths.counts.iterations++;
    }
}

// Reset previous measurement
function wavelengths_reset() {
    // Clear stored wavelengths
    wavelengths.values = [];
    wavelengths.results.reduced_values = [];
    // Clear results
    wavelengths.results.average = 0;
    wavelengths.results.stdev = 0;
    wavelengths.results.reduced_average = 0;
    wavelengths.results.reduced_stdev = 0;
    // Reset counters
    wavelengths.counts.values = 0;
    wavelengths.counts.failures = 0;
    wavelengths.counts.iterations = 0;
}

// Start a timer to measure wavelength measurement time
function wavelengths_timing_start() {
    wavelengths.timing.start_time = performance.now();
}

// End measurement timer and print results
function wavelengths_timing_end() {
    wavelengths.timing.end_time = performance.now();
    wavelengths.timing.elapsed_time = wavelengths.timing.end_time - wavelengths.timing.start_time;
    console.log(`Time to complete wavelength measurement: ${(wavelengths.timing.elapsed_time / 1000).toFixed(3)} s`);
}

/* End of wavelengths function definitions */


// Get error in wavenumbers for nIR
// del_iIR, del_mIR = del_nIR
// del_fIR = 2 del_nIR
function get_del_nu(wavelength, stdev) {
    return - (Math.pow(10, 7) * stdev) / (Math.pow(wavelength, 2) + wavelength * stdev);
}



/* Functions for OPO */

// Is this object gonna confuse with the laser module?
const opo = {
    network: {
        client: new net.Socket(),
        config: {
            host: "169.254.170.155",
            port: 1315,
        },
        command: {
            get_wl: "TELLWL",
            get_motor_status: "TELLSTAT",
            move_fast: "SETSP 3.0", // Move 3 nm/sec
            move_slow: "SETSP 0.66", // Move 0.66 nm/sec
            move: (val) => { return "GOTO " + val.toFixed(3) },
        },
        connect: () => { opo_client.connect(this.config, () => {}) },
        close: () => { opo_client.end() },
    },
    status: {
        motors_moving: false,
        current_wavelength: 0,
    },
    params: {
        lower_wl_bound: 710,
        upper_wl_bound: 880,
    },
    get_wavelength: () => { opo.network.client.write(opo_cmd.get_wl, () => {}) },
    update_wavelength: (wavelength) => opo_update_wavelength(),
    are_motors_moving: () => opo_are_motors_moving(),
    get_motor_status: () => { opo_client.write(opo_cmd.get_motor_status, () => {}) },
    goto_nir: (nir_wavelength) => opo_goto_nir(nir_wavelength),
    parse_error: (error_code) => opo_parse_error(),
}

// Receive message from OPO computer
opo.network.client.on("data", (data) => {
    // Convert to string
    data = data.toString();
    // Get rid of newline character "/r/n"
    data = data.replace("\r\n", "");
    // Filter motor movement results, which are hexadecimal numbers
    if (data.startsWith("0x")) {
        // Note: Don't use triple equals here
        if (data == 0) {
            // Motors are done moving
            opo.status.motors_moving = false;
            return;
        }
        // Motors are still moving
        opo.status.motors_moving = true;
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



//
//
//
//
//

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
        // Get OPO's recorded wavelength
        get_opo_wavelength();
        // Measure the wavelength
        setTimeout(() => {wavelengths.measure(50)}, 10000 /* ms */)
        //wavelengths.measure();
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
    console.log(`OPO Error #${error_code}: ${opo_errors[error_code]}`);
}

// Update nIR wavelength value given by OPO
function update_opo_wavelength(wavelength) {
    console.log("Wavelength:", wavelength);
    opo_status.current_wl = wavelength;
}

/* Functions for Wavelength Conversion */

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
    if (use_nm) {
        wavenumber = laser.convert_wn_wl(wavenumber);
    }
    let [desired_mode, nir_wl] = get_nir_wavelength(wavenumber);
    if (!desired_mode) {
        // Wavelength was out of range
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

// Paired with previous function, get the nIR wavelength from IR energy in wavenumbers
function get_nir_wavelength(wavenumber) {
    let nir_wl;
    let nir_wn;
    let desired_mode;
    let yag_wl = laser.excitation.wavelength.yag_fundamental; // YAG fundamental (nm)
	let yag_wn = decimal_round(laser.convert_wn_wl(yag_wl), 3); // YAG fundamental (cm^-1)
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
    } else if (2000 < wavenumber && wavenumber <= 4500) {
        // Mid IR
        desired_mode = "mir";
        nir_wn = yag_wn + wavenumber;
        nir_wl = decimal_round(laser.convert_wn_wl(nir_wn), 4);
    } else if (625 < wavenumber && wavenumber <= 2000) {
        // Far IR
        desired_mode = "fir";
        nir_wn = (3 * yag_wn - wavenumber) / 2;
        nir_wl = decimal_round(laser.convert_wn_wl(nir_wn), 4);
    } else {
        // Photon energy out of range
        console.log(`Energy of ${wavenumber} cm^-1 Out of Range`);
        return [];
    }
    return [desired_mode, nir_wl];
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
