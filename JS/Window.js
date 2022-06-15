// Imported Libraries

// OPO/A is controlled through TCP communication, which is done through JS module Net
const net = require("net");
const fs = require("fs");
// Wavemeter is controlled through C++, which requires node addons
const wavemeter = require("bindings")("wavemeter");

window.onload = function () {
	startup();
};

function startup() {
	laser.excitation.mode = "mir";
	//init_opo();
	opo.network.connect();
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
			move: (val) => {
				return "GOTO " + val.toFixed(3);
			},
		},
		connect: () => {
			opo.network.client.connect(opo.network.config, () => {});
		},
		close: () => {
			opo.network.client.end();
		},
	},
	status: {
		motors_moving: false,
		current_wavelength: 0,
	},
	params: {
		lower_wl_bound: 710,
		upper_wl_bound: 880,
	},
	/**
	 * Get the nIR wavelength recorded by the OPO
	 */
	get_wavelength: () => {
		opo.network.client.write(opo.network.command.get_wl, () => {});
	},
	/**
	 * Update the wavelength stored in opo object
	 * @param {number} wavelength - nIR wavelength (nm)
	 */
	update_wavelength: (wavelength) => opo_update_wavelength(wavelength),
	/**
	 * Ask OPO if the motors are still moving
	 */
	are_motors_moving: () => opo_are_motors_moving(),
	/**
	 * Get status of OPO motors
	 */
	get_motor_status: () => {
		opo.network.client.write(opo.network.command.get_motor_status, () => {});
	},
	/**
	 * Move OPO to specific nIR wavelength
	 * @param {number} nir_wavelength - nIR wavelength (nm)
	 */
	goto_nir: (nir_wavelength) => opo_goto_nir(nir_wavelength),
	/**
	 * Parse error returned by OPO
	 * @param {number} error_code - code returned by OPO
	 * @returns
	 */
	parse_error: (error_code) => opo_parse_error(),
};

// Tell OPO to move to nir wavelength
function opo_goto_nir(nir_wavelength) {
	// Make sure wavelength is in proper OPO bounds
	if (nir_wavelength < opo.params.lower_wl_bound || nir_wavelength > opo.params.upper_wl_bound) {
		console.log(`Wavelength ${wl} nm is out of OPO bounds: ${lower_wl_bound} - ${upper_wl_bound}`);
		return false;
	}
	// Make sure wavelength isn't too close to current wavelength
	if (Math.abs(nir_wavelength - opo.status.current_wavelength) < 0.005) {
		console.log("Wavelength too close to current wavelength");
		return false;
	}
	opo.status.motors_moving = true;
	opo.network.client.write(opo.network.command.move(nir_wavelength), () => {});
	return true;
}

// Update nIR wavelength value given by OPO
function opo_update_wavelength(wavelength) {
	console.log("Wavelength:", wavelength);
	opo.status.current_wavelength = wavelength;
}

// Parse OPO error
function opo_parse_error(error_code) {
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
		"No USB Voltmeter Detected",
	];
	// Print the error to console
	console.log(`OPO Error #${error_code}: ${opo_errors[error_code]}`);
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
		opo.parse_error(data);
		return;
	}
	// Only remaining option is it's the OPO's wavelength
	opo.update_wavelength(data);
});

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

//////////////////////////////////////////////////////

// Convert OPO/A laser energies
function convert(nir_wl) {
	const converted_energies = {
		nir: { wavelength: 0, wavenumber: 0 },
		iir: { wavelength: 0, wavenumber: 0 },
		mir: { wavelength: 0, wavenumber: 0 },
		fir: { wavelength: 0, wavenumber: 0 },
	};
	let input_wn = decimal_round(laser.convert_wn_wl(nir_wl), 3); // Input energy (cm^-1)
	let yag_wl = laser.excitation.wavelength.yag_fundamental; // YAG fundamental (nm)
	let yag_wn = decimal_round(laser.convert_wn_wl(yag_wl), 3); // YAG fundamental (cm^-1)
	// Near-IR, will be the same as input value
	converted_energies.nir.wavelength = nir_wl;
	converted_energies.nir.wavenumber = input_wn;
	// Intermediate-IR, 2 * YAG - nIR (cm^-1)
	let iir_wn = 2 * yag_wn - input_wn; // iIR (cm^-1)
	let iir_wl = laser.convert_wn_wl(iir_wn); // iIR (nm)
	converted_energies.iir.wavelength = decimal_round(iir_wl, 3);
	converted_energies.iir.wavenumber = decimal_round(iir_wn, 3);
	// Mid-IR, YAG - iIR (cm^-1)
	let mir_wn = yag_wn - iir_wn; // mIR (cm^-1)
	let mir_wl = laser.convert_wn_wl(mir_wn); // mIR (nm)
	converted_energies.mir.wavelength = decimal_round(mir_wl, 3);
	converted_energies.mir.wavenumber = decimal_round(mir_wn, 3);
	// Far-IR, iIR - mIR (cm^-1)
	let fir_wn = iir_wn - mir_wn; // fIR (cm^-1)
	let fir_wl = laser.convert_wn_wl(fir_wn); // fIR (nm)
	converted_energies.fir.wavelength = decimal_round(fir_wl, 3);
	converted_energies.fir.wavenumber = decimal_round(fir_wn, 3);
	return converted_energies;
}

// Asynchronously move the OPO to desired nIR
async function move_to_ir(wavenumber, use_nm) {
	// Convert from nm to wavenumber if necessary
	if (use_nm) {
		wavenumber = laser.convert_wn_wl(wavenumber);
	}
	// Calculate the nIR wavelength (and get IR mode (nIR, iIR, mIR, fIR))
	let [desired_mode, nir_wl] = get_nir_wavelength(wavenumber);
	if (!desired_mode) {
		// Wavelength was out of range
		return;
	}
	console.log("Desired nIR", nir_wl);

	// Change OPO wavelength and measure
	let iterations = 0;
	let measured = await move_to_ir_once(nir_wl, desired_mode, wavenumber);

	if (Math.abs(measured.energy_difference) > 0.3) {
		// Not close enough, need to iterate
		measured = await move_to_ir_once(nir_wl + measured.wl_difference, desired_mode, wavenumber);
		// (Update the nIR to account for offset, but still give original desired energy)
		iterations++;
	}

	/*while (Math.abs(measured.energy_difference) > 0.3) {
        // Not close enough, need to iterate
        measured = await move_to_ir_once(nir_wl + measured.wl_difference, desired_mode, wavenumber); 
        // (Update the nIR to account for offset, but still give original desired energy)
        iterations++;
        // Check if we've iterated too many times
        if (iterations > 3) {
            break;
        }
    } */
	console.log(`${iterations} iterations`, measured);
	return measured;
}

// Single iteration of moving OPO wavelength and measuring actual wavelength
async function move_to_ir_once(desired_nir_wl, desired_mode, desired_wavenumber) {
	// First move to nIR 1 nm away from desired (OPO doesn't like small movements)
	let cmd_success = opo.goto_nir(desired_nir_wl + 1);
	// Make sure command was successful
	if (!cmd_success) {
		console.log(`Could not move to wavelength 2 nm away from IR energy of ${desired_wavenumber} cm-1`);
		return;
	}

	// Wait for motors to stop moving (asynchronous)
	let motor_movement = await wait_for_motors();

	// After motors stopped moving, wait 5s to give motors a break
	await new Promise((resolve) => setTimeout(() => resolve(), 5000));

	/* Now move to desired wavelength */

	// Tell the OPO to move to desired nIR (synchronous)
	cmd_success = opo.goto_nir(desired_nir_wl);
	// Make sure command was successful
	if (!cmd_success) {
		console.log(`Could not move to IR energy of ${desired_wavenumber} cm-1`);
		return;
	}

	// Wait for motors to stop moving (asynchronous)
	motor_movement = await wait_for_motors();

	// Ask the OPO what it thinks its wavelength is
	opo.get_wavelength();

	// After motors stopped moving, wait 10s for wavelength to settle
	await new Promise((resolve) => setTimeout(() => resolve(), 10000));

	// Measure wavelength with reduced averaging
	const wl_measurements = await measure_reduced_wavelength();

	// Figure out difference between desired and measured energy and nIR wavelength
	const converted_energy = convert(wl_measurements.average);
	const measured_energy = converted_energy[desired_mode].wavenumber;
	const measured = {
		desired_wl: desired_nir_wl,
		desired_energy: desired_wavenumber,
		wavelength: wl_measurements.average,
		energy: measured_energy,
		opo_wl: opo.status.current_wavelength,
		wl_difference: desired_nir_wl - wl_measurements.average,
		energy_difference: desired_wavenumber - measured_energy,
		wl_measurements: wl_measurements,
	};

	return measured;
}

// Check if motors are moving every 500ms until they are stopped asynchronously
async function wait_for_motors() {
	while (opo.status.motors_moving) {
		await new Promise((resolve) =>
			setTimeout(() => {
				opo.get_motor_status();
				resolve();
			}, 500)
		);
	}
	return true;
}

// Measure wavelengths and find reduced average (asynchronous)
async function measure_reduced_wavelength() {
	const measured_values = [];
	let measured_value_length = 50; // Number of wavelengths to measure
	let minimum_stdev = 0.01; // Reduce wavelength array until stdev is below this value
	let minimum_length = 10; // Minimum number of wavelengths to keep during reduction
	let max_iteration_count = 10; // Maximum number of iterations in reduction
	let fail_count = 0; // Keep track of how many failed measurements there were
	let wl;
	while (measured_values.length < measured_value_length) {
		await new Promise((resolve) =>
			setTimeout(() => {
				wl = wavemeter.getWavelength();
				if (wl > 0) {
					// Make sure we didn't get the same measurement twice by comparing against last measurement
					if (wl !== measured_values.at(-1)) {
						measured_values.push(wl);
					}
				} else {
					// Wavelength was not measured, uptick failure count
					fail_count++;
				}
				resolve();
			}, 100)
		);
		// Check if there were too many failures
		if (fail_count > 0.2 * measured_value_length) {
			console.log(`Wavelength measurement: ${fail_count} failed measurements - Canceled`);
			return false;
		}
	}
	// Now we have enough measurements - get rid of outliers until standard deviation is low enough
	return get_reduced_average(measured_values, minimum_stdev, minimum_length, max_iteration_count);
}

// Calculate average and filter outliers until standard deviation is small enough
function get_reduced_average(values, minimum_stdev, minimum_length, max_iteration_count) {
	let iteration_count = 0; // Keep track of how many iterations were used to get reduced average
	let avg;
	let stdev = 100;
	const reduced_avg_results = {
		average: 0,
		stdev: 0,
		iteration_count: 0,
		initial_values: values,
		final_values: [],
	};

	while (stdev > minimum_stdev) {
		[avg, stdev] = average(values);
		if (values.length < minimum_length || iteration_count > max_iteration_count) {
			break;
		}
		// Filter out values more than 1 stdev away from average
		values = values.filter((val) => avg - stdev < val && val < avg + stdev);
		// Uptick reduction iteration counter
		iteration_count++;
	}

	reduced_avg_results.average = avg;
	reduced_avg_results.stdev = stdev;
	reduced_avg_results.iteration_count = iteration_count;
	reduced_avg_results.final_values = values;

	return reduced_avg_results;
}

// Get the average and standard deviation of an array
function average(array) {
	const len = array.length;
	const sum = array.reduce((accumulator, current_value) => {
		return accumulator + current_value;
	});
	const average = sum / len;
	const stdev = Math.sqrt(array.map((x) => Math.pow(x - average, 2)).reduce((a, b) => a + b) / len);
	return [average, stdev];
}

// Simulate scanning mode
async function scanning_mode() {
	// Make sure screen stays awake
	await request_wake_lock();

	console.time("Scanning");
	// mIR
	let starting_energy = 3750;
	let ending_energy = 3780;
	/*// fIR
    let starting_energy = 1845;
    let ending_energy = 1875;*/
	/*// mIR 2
    let starting_energy = 3925;
    let ending_energy = 3955; */
	/*// fIR 2
    let starting_energy = 1500;
    let ending_energy = 1530;*/
	let energy_step = 1.5;
	const energies = [];
	const measurement_results = [];
	let measured;
	for (let energy = starting_energy; energy <= ending_energy; energy += energy_step) {
		measured = await move_to_ir(energy);
		energies.push(measured.energy);
		measurement_results.push(measured);
		// Wait 10s as a stand-in for data collection
		await new Promise((resolve) => setTimeout(() => resolve(), 10000));
	}
	console.log("Done!", energies);
	console.timeEnd("Scanning");
	console.log(`Subtract ${10 * energies.length}s off time`);

	// Save measurement results to file
	let save_string = JSON.stringify(measurement_results, null, "\t");
	fs.writeFile("./wavelength_measurements/measurement_results.json", save_string, () => {});

	// Let screen sleep
	if (wake_lock) {
		wake_lock.release();
	}
}

// Functions for keeping screen awake
let wake_lock = null;

// Keep screen awake
async function request_wake_lock() {
	try {
		wake_lock = await navigator.wakeLock.request();
		// Use wake_lock.release() to release
		wake_lock.addEventListener("release", () => {
			wake_lock = null;
		});
	} catch (err) {
		console.log(`Screen lock error: ${err.name}, ${err.message}`);
	}
}
