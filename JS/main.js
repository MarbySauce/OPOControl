const { app, BrowserWindow, dialog, ipcMain, nativeTheme, Menu } = require("electron");

let my_window; // Hidden window used to communicate with camera and centroid images

function create_window() {
	// Create the window
	win = new BrowserWindow({
		width: 400,
		height: 400,
		//show: false,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			backgroundThrottling: false,
		},
	});

	win.loadFile("HTML/Window.html");
	win.webContents.openDevTools();

	return win;
}

app.whenReady().then(function () {
	// Set dark mode
	nativeTheme.themeSource = "dark";

	my_window = create_window();

	app.on("activate", function () {
		if (BrowserWindow.getAllWindows().length === 0) {
			my_window = create_window();
		}
	});
});

app.on("window-all-closed", function () {
	app.quit();
});
