#ifndef UNICODE
#define UNICODE
#endif

#include <string>
#include <napi.h>

// Global variables
Napi::FunctionReference macWavelengthFn;

// Start Wavemeter Application
Napi::Number NapiStartApplication(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env(); // Napi local environment

	// Error return value
	long retVal = 0; // No error

	// Return error value
	return Napi::Number::New(env, retVal);
}

// Exit Wavemeter Application
Napi::Number NapiStopApplication(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env(); // Napi local environment

	// Error return value
	long retVal = 0; // No error

	// Return error value
	return Napi::Number::New(env, retVal);
}

// Start a wavelength measurement
Napi::Number NapiStartMeasurement(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env(); // Napi local environment

	// Error return value
	long retVal = 0; // No error

	// Return error value
	return Napi::Number::New(env, retVal);
}

// End wavelength measurement
Napi::Number NapiStopMeasurement(const Napi::CallbackInfo& info) {
	Napi::Env env = info.Env(); // Napi local environment

	// Error return value
	long retVal = 0; // No error

	// Return error value
	return Napi::Number::New(env, retVal);
}

// Get wavelength (from JS)
Napi::Value GetWavelength(const Napi::CallbackInfo& info) {
     // Get wavelength from JS and return back
	return macWavelengthFn.Call({});
}

// Set up Mac simulation wavelength function
void SetUpFunction(const Napi::CallbackInfo& info) {
	macWavelengthFn = Napi::Persistent(info[0].As<Napi::Function>());
}

// Set up module to export functions to JavaScript
Napi::Object Init(Napi::Env env, Napi::Object exports) {
	// Fill exports object with addon functions
	exports["startApplication"] = Napi::Function::New(env, NapiStartApplication);
	exports["stopApplication"] = Napi::Function::New(env, NapiStopApplication);
	exports["startMeasurement"] = Napi::Function::New(env, NapiStartMeasurement);
	exports["stopMeasurement"] = Napi::Function::New(env, NapiStopMeasurement);
	exports["getWavelength"] = Napi::Function::New(env, GetWavelength);
	exports["setUpFunction"] = Napi::Function::New(env, SetUpFunction);

    return exports;
}

// Initialize node addon
NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init);