#ifndef UNICODE
#define UNICODE
#endif

#include <string>
#include <napi.h>
#include <windows.h>
#include <wlmData.h>

/*
Important Note:
    Unlike camera_{OS}.cc, functions here all start with Napi
    to differentiate them from the functions in wlmData.dll with 
    the same name. Functions in JS are still called in camelCase, with
    Napi removed from the beginning. 
    i.e. NapiGetWavelength() would be called from JS as getWavelength()
*/

// Get wavelength
Napi::Number NapiGetWavelength(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env(); // Napi local environment

    // Initialize variable to fill with wavelength
    double lambda = 0.0;

    // Get wavelength
    lambda = GetWavelength(lambda);

    // Return wavelength
    return Napi::Number::New(env, lambda);
}

// Set up module to export functions to JavaScript
Napi::Object Init(Napi::Env env, Napi::Object exports) {
	// Fill exports object with addon functions
	exports["getWavelength"] = Napi::Function::New(env, NapiGetWavelength);

    return exports;
}

// Initialize node addon
NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init);