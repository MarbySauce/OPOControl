// Imported Libraries

// OPO/A is controlled through TCP communication, which is done through JS module Net
const net = require("net");
const fs = require("fs");
// Wavemeter is controlled through C++, which requires node addons
const wavemeter = require("bindings")("wavemeter");
const { performance } = require("perf_hooks");
const EventEmitter = require("events").EventEmitter;

const wmEmitter = new EventEmitter();

const wmMessages = {
	Alert: {
		Motors_Stopped: "wm_Alert_Motors_Stopped",
		Current_Wavelength: "wm_Alert_Current_Wavelength"
	}
}


window.onload = function () {
	startup();
};

function startup() {
	laser.excitation.mode = "mir";
	// Connect to OPO
	opo.network.connect();
	// Set up Mac wavemeter simulation function
	initialize_mac_fn();
	// Get OPO wavelength
	setTimeout(() => {
		opo.get_wavelength();
	}, 1000);
}

/* Functions for OPO */

const opo = {
	network: {
		client: new net.Socket(),
		config: {
			//host: "localhost",
			host: "169.254.170.155",
			port: 1315,
		},
		command: {
			get_wl: "TELLWL",
			get_motor_status: "TELLSTAT",
			move: (val) => {
				return "GOTO " + val.toFixed(3);
			},
		},
		connect: () => {
			if (opo.status.connected) {
				// Already connected
				return;
			}
			opo.network.client.connect(opo.network.config, (error) => {
				if (error) {
					console.log(`Could not connect to OPO: ${error}`);
				} else {
					opo.status.connected = true;
				}
			});
		},
		close: () => {
			opo.network.client.end();
			opo.status.connected = false;
		},
	},
	status: {
		connected: false,
		motors_moving: false,
		current_wavelength: 0,
	},
	params: {
		lower_wl_bound: 710,
		upper_wl_bound: 880,
		expected_shift: 0, //0.257, // nm
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
	 * Set OPO movement speed (in nm/sec)
	 * @param {number} speed - OPO nIR movement speed (in nm/sec)
	 */
	set_speed: (speed) => {
		let nIR_speed = speed || 1.0; // Default value of 1 nm/sec
		console.log(`SETSPD ${nIR_speed.toFixed(3)}`);
		opo.network.client.write(`SETSPD ${nIR_speed.toFixed(3)}`, () => {});
	},
	/**
	 * Parse error returned by OPO
	 * @param {number} error_code - code returned by OPO
	 * @returns
	 */
	parse_error: (error_code) => opo_parse_error(error_code),
};


// Tell OPO to move to nir wavelength
function opo_goto_nir(nir_wavelength) {
	// Make sure wavelength is in proper OPO bounds
	if (nir_wavelength < opo.params.lower_wl_bound || nir_wavelength > opo.params.upper_wl_bound) {
		console.log(`Wavelength ${wl} nm is out of OPO bounds: ${lower_wl_bound} - ${upper_wl_bound}`);
		return false;
	}
	// Make sure wavelength isn't too close to current wavelength
	/*if (Math.abs(nir_wavelength - opo.status.current_wavelength) < 0.005) {
		console.log("Wavelength too close to current wavelength");
		return false;
	}*/
	opo.status.motors_moving = true;
	console.log(opo.network.command.move(nir_wavelength));
	opo.network.client.write(opo.network.command.move(nir_wavelength), () => {});
	return true;
}

// Update nIR wavelength value given by OPO
function opo_update_wavelength(wavelength) {
	console.log("Wavelength:", wavelength);
	wmEmitter.emit(wmMessages.Alert.Current_Wavelength, wavelength);
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
	// Split data up (in case two things came at the same time)
	data = data.split("\r\n");
	// Process message(s)
	data.forEach((msg) => {
		if (msg) {
			process_opo_data(msg);
		}
	});
});

// Receive error message (e.g. cannot connect to server)
opo.network.client.on("error", (error) => {
	console.log(`OPO Connection ${error}`);
	opo.status.connected = false;
});

function process_opo_data(data) {
	// Get rid of newline character "/r/n"
	data = data.replace("\r\n", "");
	// Filter motor movement results, which are hexadecimal numbers
	if (data.startsWith("0x")) {
		// Note: Don't use triple equals here
		if (data == 0) {
			// Motors are done moving
			wmEmitter.emit(wmMessages.Alert.Motors_Stopped);
			opo.status.motors_moving = false;
			return;
		}
		// Motors are still moving
		opo.status.motors_moving = true;
		return;
	}
	// Make sure it is a number (not an unexpected result)
	if (isNaN(data)) {
		console.log("Message from OPO:", data);
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
		return [undefined, undefined];
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

	const opo_movements = {
		first: undefined,
		second: undefined,
		final: undefined, // No matter how many iterations done, final is filled with last measurement
	};

	// Change OPO wavelength and measure
	let iterations = 0;
	let measured = await move_to_ir_once(nir_wl + opo.params.expected_shift, desired_mode, wavenumber);

	opo_movements.first = measured;

	if (Math.abs(measured.energy_difference) > 0.3) {
		// Not close enough, need to iterate
		// Check that it's not trying to move too far (i.e. wavelength measurement isn't off)
		opo.set_speed(0.01);
		if (Math.abs(measured.wl_difference) < 1.5) {
			//measured = await move_to_ir_once(nir_wl + 0.5 * measured.wl_difference, desired_mode, wavenumber);
			measured = await move_to_ir_once(nir_wl + 0.01 * (2 * (measured.wl_difference > 0) - 1), desired_mode, wavenumber);
			// (Update the nIR to account for offset, but still give original desired energy)
		} else {
			console.log(`Moving nIR by expected shift of ${opo.params.expected_shift} nm`);
			measured = await move_to_ir_once(nir_wl + opo.params.expected_shift, desired_mode, wavenumber);
		}
		opo.set_speed(0.1);
		iterations++;

		opo_movements.second = measured;
	}

	opo_movements.final = measured;

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
	return opo_movements;
}

// Single iteration of moving OPO wavelength and measuring actual wavelength
async function move_to_ir_once(desired_nir_wl, desired_mode, desired_wavenumber) {
	// First move to nIR 1 nm away from desired (OPO doesn't like small movements)
	/*let cmd_success = opo.goto_nir(desired_nir_wl + 1);
	// Make sure command was successful
	if (!cmd_success) {
		console.log(`Could not move to wavelength 1 nm away from IR energy of ${desired_wavenumber} cm-1`);
		return;
	}

	// Wait for motors to stop moving (asynchronous)
	let motor_movement = await wait_for_motors();

	// After motors stopped moving, wait 5s to give motors a break
	await new Promise((resolve) => setTimeout(() => resolve(), 5000));*/

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
	//await new Promise((resolve) => setTimeout(() => resolve(), 10000));

	// Measure wavelength with reduced averaging
	let wl_measurements = await measure_reduced_wavelength(desired_nir_wl);

	// Check if measured wavelength is far from expected
	if (Math.abs(wl_measurements.final.average - opo.status.current_wavelength) > 1.5) {
		// Remeasure wavelength
		console.log("Remeasuring wavelength");
		wl_measurements = await measure_reduced_wavelength(desired_nir_wl);
	}

	// Figure out difference between desired and measured energy and nIR wavelength
	const converted_energy = convert(wl_measurements.final.average);
	const measured_energy = converted_energy[desired_mode].wavenumber;
	const measured = {
		desired_wl: desired_nir_wl,
		desired_energy: desired_wavenumber,
		wavelength: wl_measurements.final.average,
		energy: measured_energy,
		opo_wl: opo.status.current_wavelength,
		wl_difference: desired_nir_wl - wl_measurements.final.average,
		energy_difference: desired_wavenumber - measured_energy,
		wl_measurements: wl_measurements,
	};

	return measured;
}

// Check if motors are moving every 500ms until they are stopped asynchronously
async function wait_for_motors() {
	while (opo.status.motors_moving) {
		// Check every 500ms if motors are still moving
		await new Promise((resolve) =>
			setTimeout(() => {
				opo.get_motor_status();
				resolve();
			}, 500)
		);
	}
	return true;
}

/**
 * (Async function) Measure wavelengths and find reduced average
 * @param {number} expected_wl - wavelength to expect during measurements (nm)
 * @returns {number} wavelength, returns 0 if unable to measure
 */
async function measure_wavelength(expected_wl) {
	const measured_values = [];
	let measured_value_length = 50; // Number of wavelengths to measure
	let minimum_stdev = 0.01; // Reduce wavelength array until stdev is below this value
	let minimum_length = 10; // Minimum number of wavelengths to keep during reduction
	let too_far_val = 1; // nm, wavelength values too_far_val nm away from expected will be removed (if expected_wl given)
	let max_iteration_count = 10; // Maximum number of iterations in reduction
	let fail_count = 0; // Keep track of how many failed measurements there were
	let bad_measurements = 0;
	let wl;

	// Start wavemeter measurement
	wavemeter.startMeasurement();

	while (measured_values.length < measured_value_length) {
		// Get measurement wavelength every IR pulse (100ms / 10Hz)
		await new Promise((resolve) =>
			setTimeout(() => {
				wl = wavemeter.getWavelength();
				// Make sure there actually was a measurement to get
				if (wl > 0) {
					// Make sure we didn't get the same measurement twice by comparing against last measurement
					if (wl !== measured_values[measured_values.length-1]) {
						// If an expected wavelength was given, make sure measured value isn't too far away
						if (expected_wl) {
							if (Math.abs(wl - expected_wl) < too_far_val) {
								measured_values.push(wl);
							} else {
								// This was a bad measurement
								bad_measurements++;
							}
						} else {
							// No expected wavelength given, record all values
							measured_values.push(wl);
						}
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
			// Stop wavemeter measurement
			wavemeter.stopMeasurement();
			console.log(`Wavelength measurement: ${fail_count} failed measurements - Canceled`);
			return 0;
		}
		// Check if there were too many bad measurements
		if (bad_measurements >= 10 * measured_value_length) {
			// Stop wavemeter measurement
			wavemeter.stopMeasurement();
			console.log(`Wavelength measurement: ${bad_measurements} bad measurements - Canceled`);
			return 0;
		}
	}
	// Stop wavemeter measurement
	wavemeter.stopMeasurement();
	// Now we have enough measurements - get rid of outliers until standard deviation is low enough
	let reduced_avg_results = get_reduced_average(measured_values, minimum_stdev, minimum_length, max_iteration_count);
	return reduced_avg_results.final.average; // Return the average wavelength
}

// Calculate average and filter outliers until standard deviation is small enough
function get_reduced_average(values, minimum_stdev, minimum_length, max_iteration_count, expected_avg, too_far_val) {
	// Expected_avg is the expected average and too_far_val is the value for which elements further than
	//		that away from average will be removed before reduction
	//	If ^ not provided, just does normal reduction
	let iteration_count = 0; // Keep track of how many iterations were used to get reduced average

	let [avg, stdev] = average(values);
	const reduced_avg_results = {
		initial: {
			average: avg,
			stdev: stdev,
			values: values,
		},
		final: {
			average: 0,
			stdev: 0,
			values: [],
		},
		iteration_count: 0,
	};

	if (expected_avg && too_far_val) {
		// Reduce by taking away unexpected values
		values = values.filter((val) => expected_avg - too_far_val < val && val < expected_avg + too_far_val);
	}

	while (stdev > minimum_stdev) {
		// Filter out values more than 1 stdev away from average
		values = values.filter((val) => avg - stdev < val && val < avg + stdev);
		// Uptick reduction iteration counter
		iteration_count++;

		if (values.length < minimum_length || iteration_count > max_iteration_count) {
			break;
		}

		[avg, stdev] = average(values);
	}

	reduced_avg_results.final = {
		average: avg,
		stdev: stdev,
		values: values,
	};
	reduced_avg_results.iteration_count = iteration_count;

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
	/*// mIR
	let starting_energy = 3750;
	let ending_energy = 3780;*/
	/*// fIR
    let starting_energy = 1845;
    let ending_energy = 1875;*/
	// mIR 2
	let starting_energy = 3925;
	let ending_energy = 3955;
	/*// fIR 2
    let starting_energy = 1500;
    let ending_energy = 1530;*/
	/*// mIR 3
	let starting_energy = 3770;
	let ending_energy = 3800;*/
	/*// mIR 4
	let starting_energy = 3660;
	let ending_energy = 3690;*/
	let energy_step = 1.5;
	const energies = [];
	const energy_diffs = [];
	const measurement_results = [];
	const wl_shifts = [];
	let measured;
	// First move to the starting energy at a higher speed
	opo.move_fast();
	await move_to_ir(starting_energy);
	// Use slower speed for small increments
	opo.move_slow();
	for (let energy = starting_energy; energy <= ending_energy; energy += energy_step) {
		measured = await move_to_ir(energy);
		energies.push(measured.final.energy);
		energy_diffs.push(measured.final.energy_difference);
		measurement_results.push(measured);
		wl_shifts.push(measured.final.wl_difference);
		// Wait 10s as a stand-in for data collection
		await new Promise((resolve) => setTimeout(() => resolve(), 10000));
		//await new Promise((resolve) => setTimeout(() => resolve(), 1000));
	}
	console.log("Done!", energies);
	console.log(energy_diffs);
	console.log("Average wl shift:", average(wl_shifts));
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

/* Functions for simulating wavemeter on Mac */

// Return a wavelength based on OPO's defined wavelength
function mac_wavelength() {
	// Get the OPO's wavelength
	let wl = opo.status.current_wavelength;
	// Add a bias
	wl -= 0.2565;
	// Add some noise
	wl += norm_rand(0, 0.01);
	// Small chance of wavelength being very far off
	if (Math.random() < 0.1) {
		wl -= 20;
	}
	return wl;
}

// Initialize JS function on C++ side
function initialize_mac_fn() {
	wavemeter.setUpFunction(mac_wavelength);
}

/**
 * Random number with normal distribution
 * @param {Number} mu - center of normal distribution (mean)
 * @param {Number} sigma - width of normal distribution (sqrt(variance))
 * @returns {Number} random number
 */
function norm_rand(mu, sigma) {
	let u = 0,
		v = 0;
	while (u === 0) u = Math.random(); //Converting [0,1) to (0,1)
	while (v === 0) v = Math.random();
	return sigma * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) + mu;
}

async function sleep(delay_ms) {
	return new Promise((resolve) => setTimeout(resolve, delay_ms));
}

function time_convert(time) {
	let hours = Math.floor(time / (60 * 60 * 1000));
	let hours_remainder = time % (60 * 60 * 1000);
	let minutes = Math.floor(hours_remainder / (60 * 1000));
	let minutes_remainder = hours_remainder % (60 * 1000);
	let seconds = Math.floor(minutes_remainder / 1000);
	let ms = minutes_remainder % 1000;
	return [ms, seconds, minutes, hours];
}


//////////////////////////////////////////////////////////////////

class Timer {
	constructor(name) {
		this.name = name || "Undefined"
		this.start_time = performance.now();
		this.end_time = 0;
		this.duration = 0;
	}

	start() {
		this.start_time = performance.now();
	}
	end() {
		this.end_time = performance.now();
		this.duration = this.end_time - this.start_time;
		return this.duration;
	}
	stop() {
		return this.end();
	}
	end_print() {
		this.end();
		console.log(`${this.name} timer: `, time_convert(this.duration));
	}
}

async function set_ir_energy(energy) {
	let overall_timer = new Timer("Overall");
	let measurement_timer = new Timer("Measurement");
	// First, get the current wavelength stored in OPO
	let opo_starting_wavelength = await new Promise((resolve) => {
		wmEmitter.once(wmMessages.Alert.Current_Wavelength, (value) => {
			resolve(value);
		});
		opo.get_wavelength();
	});
	// Get the desired nIR wavelength
	let [desired_mode, desired_nir] = get_nir_wavelength(energy);
	measurement_timer.start();
	let current_wl = await measure_wavelength(opo_starting_wavelength);
	measurement_timer.end_print();
	let wl_difference = current_wl - opo_starting_wavelength;
	let wl_error = wl_difference;
	let measured_energy;

	// Tell OPO to go to desired wavelength
	opo.set_speed(0.5);
	let energy_error = 100;
	let iterations = 0;
	while (Math.abs(energy_error) >= 0.5) {
		wl_error += await set_ir_energy_iteration(desired_nir, wl_error);
		measured_energy = convert(wl_measurement)[desired_mode].wavenumber;
		energy_error = measured_energy - energy;
		console.log("Energy error:", energy_error);
		iterations++;
		console.log("Iterations so far", iterations);
	}
	console.log("Iterations", iterations);

	
	console.log("DONE!");
	overall_timer.end_print();

	opo.set_speed();

	return energy_error;
}

async function set_ir_energy_iteration(desired_nir, nir_error) {
	let measurement_timer = new Timer("Measurement");
	let movement_timer = new Timer("Movement");
	let wl_error = nir_error || 0;
	opo.goto_nir(desired_nir - wl_error);
	// Wait for motors
	await wait_for_motors();
	//console.log("Motors finished moving");
	//movement_timer.end_print();
	// Measure wavelength with reduced averaging
	measurement_timer.start();
	wl_measurement = await measure_wavelength(desired_nir - wl_error);
	//measurement_timer.end_print();
	//console.log(wl_measurement);
	wl_error = wl_measurement - desired_nir;
	//console.log("WL Error:", wl_error);
	return wl_error;
}

async function set_ir_energy_one_iteration(energy) {
	console.log(`Moving to energy ${energy}`);
	let overall_timer = new Timer("Overall");
	// First, get the current wavelength stored in OPO
	let opo_starting_wavelength = await new Promise((resolve) => {
		wmEmitter.once(wmMessages.Alert.Current_Wavelength, (value) => {
			resolve(value);
		});
		opo.get_wavelength();
	});
	// Get the desired nIR wavelength
	let [desired_mode, desired_nir] = get_nir_wavelength(energy);
	let current_wl = await measure_wavelength(opo_starting_wavelength);
	let wl_difference = current_wl - opo_starting_wavelength;

	opo.set_speed(0.05);
	await set_ir_energy_iteration(desired_nir, wl_difference);
	let measured_energy = convert(wl_measurement)[desired_mode].wavenumber;
	energy_error = measured_energy - energy;
	console.log("Energy error:", energy_error);

	overall_timer.end_print();

	opo.set_speed();

	return energy_error;
}


async function check_1iter_errors(energy_gap, energy_steps) {
	let one_iter_timer = new Timer();
	let overall_timer = new Timer("Overall");
	let starting_energy = 1860;
	let gap = energy_gap || 5;
	let steps = energy_steps || 10;
	let errors = [];
	let errors2 = [];
	let durations = [];
	let err;
	for (let i = 0; i < steps; i++) {
		one_iter_timer.start();
		err = await set_ir_energy_one_iteration(starting_energy + gap * i);
		durations.push(one_iter_timer.stop());
		errors.push(err);
		errors2.push(Math.pow(err, 2));
		// Sleep for 5s
		await sleep(5000);
	}
	console.log("Fully DONE");
	overall_timer.end_print();
	console.log(average(errors));
	console.log(average(errors2));
	let [dur_avg, dur_var] = average(durations);
	console.log(time_convert(dur_avg), time_convert(dur_var));
	console.log("Max error",Math.sqrt(Math.max(...errors2)));
	console.log("Max time", time_convert(Math.max(...durations)));
}


async function measure_ir_repeatedly(iterations) {
	let errors = [];
	let wls = [];
	let num_iters = iterations || 10;
	let wl_measurement, wl_error;
	// First, get the current wavelength stored in OPO
	let opo_starting_wavelength = await new Promise((resolve) => {
		wmEmitter.once(wmMessages.Alert.Current_Wavelength, (value) => {
			resolve(value);
		});
		opo.get_wavelength();
	});
	// Measure the wavelength multiple times
	for (let i = 0; i < num_iters; i++) {
		wl_measurement = await measure_wavelength(opo_starting_wavelength);
		wl_error = wl_measurement - opo_starting_wavelength;
		console.log(i, opo_starting_wavelength, wl_measurement, wl_error);
		errors.push(wl_error);
		wls.push(wl_measurement)
	}
	console.log("Average wl:", average(wls));
	console.log("Average error:", average(errors));
}