#ifndef UNICODE
#define UNICODE
#endif

#include <string>
#include <napi.h>
#include <iostream>


// Global variables
Napi::FunctionReference macWavelengthFn;


using namespace std;


// Get wavelength
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
	exports["getWavelength"] = Napi::Function::New(env, GetWavelength);
	exports["setUpFunction"] = Napi::Function::New(env, SetUpFunction);

    return exports;
}

// Initialize node addon
NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init);