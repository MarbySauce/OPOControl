# Imports
import matplotlib.pyplot as plt
import json 
from math import sqrt

# Analyze the measurement results (OPO scanning tests)
# Objects' subclasses detailed in measurement results readme

# Variables to edit

file_name = "mir_14"			# Name of .json file to look at
desired_energy = 377			# Specific energy measurement to analyze

base_file = "./wavelength_measurements/measurement_results_"
full_file_name = base_file + file_name + ".json"

error_threshold = 1 		# If max error is above this, calculate reduced errors

run_test = False 			# Whether to run the test() function (True) or main() function (False)


# Function to run on execution
def main():
	print(f"Looking at {file_name}")
	results = parse_json(full_file_name)

	# Get error results and print
	Avg, Max, Min = get_errors(results)
	print(f"Average error: {Avg:.3f} cm-1, max error: {Max:.3f} cm-1, min error: {Min:.3f} cm-1")
	# If max error is large, get error results excluding outliers
	if Max > error_threshold:
		Avg, Max, Min = get_reduced_errors(results)
		print(f"Reduced - average error: {Avg:.3f} cm-1, max error: {Max:.3f} cm-1, min error: {Min:.3f} cm-1")

	# Plot expected vs measured wavelengths
	plot_wavelengths(results)

	# Plot measured wavelengths for a specific desired energy
	# Make sure desired energy is actually within range
	if "final" in results[0]:
		if results[0]["final"]["desired_energy"] <= desired_energy <= results[-1]["final"]["desired_energy"]:
			plot_wavelength_hist(results, desired_energy)
	else:
		if results[0]["desired_energy"] <= desired_energy <= results[-1]["desired_energy"]:
			plot_wavelength_hist(results, desired_energy)



	# Show plots
	plt.show()


# Test function to run in test mode
def test():
	print(f"Looking at {file_name}")
	results = parse_json(full_file_name)

	opo_shift_initial = []
	opo_shift_final = []

	for result in results:
		if "second" in result:
			opo_shift = result["second"]["wavelength"] - result["second"]["opo_wl"]
			opo_shift_final.append(opo_shift)
		opo_shift = result["first"]["wavelength"] - result["first"]["opo_wl"]
		opo_shift_initial.append(opo_shift)
	
	print(get_average(opo_shift_initial))
	print(get_average(opo_shift_final))




####### Function Definitions #######

# Read json file and return as an array
def parse_json(file_name):
	results = json.load(open(file_name))
	return results

# Plot the expected wavelengths and measured wavelengths
def plot_wavelengths(results: list):
	fig, ax1 = plt.subplots()
	increments = [i for i in range(len(results))]
	# Figure out whether the file is from 6/14/22 or 6/15/22
	if "final" in results[0]:
		# Version from 6/15/22
		expected = [result["final"]["desired_energy"] for result in results]
		measured = [result["final"]["energy"] for result in results]
		first_measured = [result["first"]["energy"] for result in results]
	else:
		# Version from 6/14/22
		expected = [result["desired_energy"] for result in results]
		measured = [result["energy"] for result in results]
	# Calculate absolute difference
	difference = [abs(expect - measure) for expect, measure in zip(expected, measured)]
	# Plot expected and measured values as scatter plot
	color = "C1"
	ax1.scatter(increments, expected, label = "expected")
	ax1.scatter(increments, first_measured, color = "green", label = "first measured")
	ax1.scatter(increments, measured, color = color, label = "measured")
	ax1.set_ylabel("Energy ($cm^{-1}$)")
	ax1.tick_params("y", labelcolor = color)
	ax1.set_xlabel("Step")
	ax1.set_xticks(increments)
	ax1.set_xticklabels(increments)
	ax1.legend()
	# Plot absolute difference as stem plot
	ax2 = ax1.twinx() # Share x axis
	ax2.stem(increments, difference, basefmt=" ", markerfmt=" ", linefmt = "r-")
	ax2.set_ylabel("Absolute difference ($cm^{-1}$)")
	ax2.tick_params("y", labelcolor = "red")
	ax2.set_ylim(0, 3 * max(difference))
	fig.tight_layout()  # otherwise the right y-label is slightly clipped

# Get average, max, and min absolute errors of energy from expected
def get_errors(results: list):
	# Figure out whether the file is from 6/14/22 or 6/15/22
	if "final" in results[0]:
		# Version from 6/15/22
		expected = [result["final"]["desired_energy"] for result in results]
		measured = [result["final"]["energy"] for result in results]
		#measured = [result["first"]["energy"] for result in results]
	else:
		# Version from 6/14/22
		expected = [result["desired_energy"] for result in results]
		measured = [result["energy"] for result in results]
	# Calculate absolute difference
	difference = [abs(expect - measure) for expect, measure in zip(expected, measured)]
	average = sum(difference) / len(difference)
	return average, max(difference), min(difference)

# Same as above but exclude errors >= 5 cm-1 
def get_reduced_errors(results: list):
	# Figure out whether the file is from 6/14/22 or 6/15/22
	if "final" in results[0]:
		# Version from 6/15/22
		expected = [result["final"]["desired_energy"] for result in results]
		measured = [result["final"]["energy"] for result in results]
	else:
		# Version from 6/14/22
		expected = [result["desired_energy"] for result in results]
		measured = [result["energy"] for result in results]
	# Calculate absolute difference
	difference = [abs(expect - measure) for expect, measure in zip(expected, measured)]
	reduced_difference = [diff for diff in difference if diff < error_threshold]
	average = sum(reduced_difference) / len(reduced_difference)
	return average, max(reduced_difference), min(reduced_difference)

# Get histogram of measured wavelengths (for one desired energy)
def get_wavelength_hist(result: dict, desired_values: str = "initial_values"):
	# Could do this either as one array with 1000 pts / nm, or two arrays that keep a running tally
	# I think the latter is better when the wavelength errors are large
	wavelength_values = []
	wavelength_count = []
	# desired_values can be either "initial_values" or "final_values"
	if desired_values not in ["initial_values", "final_values"]:
		# Incorrect argument passed, default to initial values
		desired_values = "initial_values"
	# Figure out whether the file is from 6/14/22 or 6/15/22
	if "final" in result:
		# Version from 6/15/22
		# Remove "_values" from desired_values
		desired_values = desired_values[:-7]
		# Get tally of wavelength values and count
		for wavelength in result["final"]["wl_measurements"][desired_values]["values"]:
			# Get rid of floating point errors
			wavelength = round(wavelength, 3)
			# Check if wavelength is already stored in wavelength_values
			if wavelength in wavelength_values:
				# It is, find index and add to count
				wl_index = wavelength_values.index(wavelength)
				wavelength_count[wl_index] += 1
			else:
				# It is not, add to list and start count at 1
				wavelength_values.append(wavelength)
				wavelength_count.append(1)
	else:
		# Version from 6/14/22
		# Get tally of wavelength values and count
		for wavelength in result["wl_measurements"][desired_values]:
			# Get rid of floating point errors
			wavelength = round(wavelength, 3)
			# Check if wavelength is already stored in wavelength_values
			if wavelength in wavelength_values:
				# It is, find index and add to count
				wl_index = wavelength_values.index(wavelength)
				wavelength_count[wl_index] += 1
			else:
				# It is not, add to list and start count at 1
				wavelength_values.append(wavelength)
				wavelength_count.append(1)
	# Sort results by wavelength
	wavelength_values, wavelength_count = zip(*sorted(zip(wavelength_values, wavelength_count), key=lambda x: x[0]))
	# Return values as lists (idk I prefer [] over () )
	return list(wavelength_values), list(wavelength_count)

# Plot histogram of measured wavelengths (for one desired energy)
def plot_wavelength_hist(results: list, desired_energy: float):
	# Create new figure
	plt.figure()
	# Figure out whether the file is from 6/14/22 or 6/15/22
	if "final" in results[0]:
		# Version from 6/15/22
		result = next(result for result in results if result["final"]["desired_energy"] == desired_energy)
		print(f"Expected nIR wavelength: {result['final']['desired_wl']:.3f} nm, measured wavelength: {result['final']['wavelength']:.3f} nm")
		plt.title(f"Expected energy: {desired_energy}" + " $cm^{-1}$" + "\n" + f"Measured energy: {result['final']['energy']}" + " $cm^{-1}$")
	else:
		# Version from 6/14/22
		# Get dict with desired energy
		result = next(result for result in results if result["desired_energy"] == desired_energy)
		print(f"Expected nIR wavelength: {result['desired_wl']:.3f} nm, measured wavelength: {result['wavelength']:.3f} nm")
		plt.title(f"Expected energy: {desired_energy}" + " $cm^{-1}$" + "\n" + f"Measured energy: {result['energy']}" + " $cm^{-1}$")
	# Plot the initial values
	plt.scatter(*get_wavelength_hist(result, "initial_values"))
	# Plot the final (reduced) values
	plt.scatter(*get_wavelength_hist(result, "final_values"))
	# Add labels
	plt.xlabel("Measured nIR wavelength (nm)")
	plt.ylabel("Count")

# Get average and stdev of an array
def get_average(array):
	avg = sum(array) / len(array)
	stdev = sqrt(sum([(el - avg)**2 for el in array]) / len(array))
	return avg, stdev




if __name__ == "__main__":
	if run_test:
		test()
	else:
		main()