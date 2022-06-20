const net = require("net");

const end_cmd = "\r\n";

// OPO Info
const opo = {
	motors_moving: false,
	speed: 1, // nm/sec
	current_wavelength: 750,
	connection: undefined,
	send_msg: (msg) => {
		//console.log(`Sending message: '${msg}'`);
		opo.connection.write(msg + end_cmd);
	},
};

// Set up server
const server = net.createServer(function (connection) {
	console.log("client connected");
	opo.connection = connection;

	connection.on("end", function () {
		console.log("client disconnected");
		//close_server();
	});

	connection.on("data", (data) => {
		parse_data(data);
	});
});

function close_server() {
	server.close();
}

const address = "localhost"; //"169.254.170.155"
server.listen(1315, address, function () {
	console.log("server is listening");
});

function parse_data(data) {
	data = data.toString();
	// Split text into array, separated by spaces
	let passed_data = data.split(" ");
	// Used commands are SETSPD, TELLWL, TELLSTAT, and GOTO
	//		No argument should take more than 1 argument
	// Also added in command CLOSE which closes the server
	if (passed_data.length > 2) {
		send_error(1);
	}
	let [cmd, val] = passed_data;
	//console.log(`Command '${cmd}' recieved`);
	switch (cmd) {
		case "GOTO":
			go_to(val);
			break;
		case "SETSPD":
			set_speed(val);
			break;
		case "TELLWL":
			tell_wl();
			break;
		case "TELLSTAT":
			tell_stat();
			break;
		case "CLOSE":
			close_server();
			break;
		default:
			send_error(1);
			break;
	}
}

function send_error(error_code) {
	// OPO errors:
	// 		"Successfully Executed Command",
	// 		"Invalid Command",
	// 		"Required Window Not Open",
	// 		"Specified Value Is Out Of Range",
	// 		"Specified Velocity Is Out Of Safe Values",
	// 		"A GoTo Operation Is Already Active",
	// 		"Unable To Change Settings While Motor Movement Active",
	// 		"No USB Voltmeter Detected",
	//
	opo.send_msg(error_code);
}

function send_success() {
	send_error(0);
}

function go_to(val) {
	val = parseFloat(val);
	// Check that parameter is number
	if (isNaN(val)) {
		send_error(1);
		return;
	}
	// Check that the number is within bounds
	if (val < 710 || val > 880) {
		send_error(3);
		return;
	}
	// Check that motors aren't currently moving
	if (opo.motors_moving) {
		send_error(5);
		return;
	}
	// Pretend to move wavelength
	move_motors(val);
	send_success();
}

function move_motors(val) {
	let current_wavelength = opo.current_wavelength;
	let difference = Math.abs(val - current_wavelength);
	let duration = 1000 * (5 + difference / opo.speed); // ms
	// Pretend motors are moving
	opo.motors_moving = true;
	//console.log("Motors moving!");
	// After duration passed, say motors stopped
	setTimeout(() => {
		opo.motors_moving = false;
		opo.current_wavelength = val; // + 0.01 * Math.random(); // Add some variation to motors
		//console.log("Motors done moving");
	}, duration);
}

function set_speed(val) {
	val = parseFloat(val);
	// Check that parameter is number
	if (isNaN(val)) {
		send_error(1);
		return;
	}
	// Check that the number is within bounds
	if (val < 0.5 || val > 5) {
		send_error(4);
		return;
	}
	// Update speed setting
	opo.speed = val;
	send_success();
}

function tell_wl() {
	opo.send_msg(opo.current_wavelength.toFixed(5));
}

function tell_stat() {
	let motor_mvmt = "0x";
	if (opo.motors_moving) {
		// Send a hex number > 0 to say motors are moving
		motor_mvmt += "80085";
	} else {
		// Send a hex number of 0 to say motors aren't moving
		motor_mvmt += "0";
	}
	opo.send_msg(motor_mvmt);
}
