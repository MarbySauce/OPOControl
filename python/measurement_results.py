# Imports
import matplotlib.pyplot as plt
import json 

# Analyze the measurement results (OPO scanning tests)

# Variables to edit

file_name = "fir_2"			# Name of .json file to look at
desired_energy = 1524		# Specific energy measurement to analyze

base_file = "./wavelength_measurements/measurement_results_"
full_file_name = base_file + file_name + ".json"


# Function to run on execution
def main():
	print(f"Looking at {file_name}")
	results = parse_json(full_file_name)

	# Get error results and print
	Avg, Max, Min = get_errors(results)
	print(f"Average error: {Avg:.3f} cm-1, max error: {Max:.3f} cm-1, min error: {Min:.3f} cm-1")
	# If max error is large, get error results excluding outliers
	if Max > 5:
		Avg, Max, Min = get_reduced_errors(results)
		print(f"Reduced - average error: {Avg:.3f} cm-1, max error: {Max:.3f} cm-1, min error: {Min:.3f} cm-1")

	# Plot expected vs measured wavelengths
	plot_wavelengths(results)

	# Plot measured wavelengths for a specific desired energy
	# Make sure desired energy is actually within range
	if results[0]["desired_energy"] <= desired_energy <= results[-1]["desired_energy"]:
		plot_wavelength_hist(results, desired_energy)



	# Show plots
	plt.show()




####### Function Definitions #######

# Read json file and return as an array
def parse_json(file_name):
	results = json.load(open(file_name))
	return results

# Plot the expected wavelengths and measured wavelengths
def plot_wavelengths(results: list):
	fig, ax1 = plt.subplots()
	increments = [i for i in range(len(results))]
	expected = [result["desired_energy"] for result in results]
	measured = [result["energy"] for result in results]
	difference = [abs(expect - measure) for expect, measure in zip(expected, measured)]
	# Plot expected and measured values as scatter plot
	color = "C1"
	ax1.scatter(increments, expected, label = "expected")
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
	expected = [result["desired_energy"] for result in results]
	measured = [result["energy"] for result in results]
	difference = [abs(expect - measure) for expect, measure in zip(expected, measured)]
	average = sum(difference) / len(difference)
	return average, max(difference), min(difference)

# Same as above but exclude errors >= 5 cm-1 
def get_reduced_errors(results: list):
	expected = [result["desired_energy"] for result in results]
	measured = [result["energy"] for result in results]
	difference = [abs(expect - measure) for expect, measure in zip(expected, measured)]
	reduced_difference = [diff for diff in difference if diff < 5]
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
	# Get dict with desired energy
	result = next(result for result in results if result["desired_energy"] == desired_energy)
	print(f"Expected nIR wavelength: {result['desired_wl']:.3f} nm, measured wavelength: {result['wavelength']:.3f} nm")
	# Create new figure
	plt.figure()
	# Plot the initial values
	plt.scatter(*get_wavelength_hist(result, "initial_values"))
	# Plot the final (reduced) values
	plt.scatter(*get_wavelength_hist(result, "final_values"))
	# Add labels
	plt.xlabel("Measured nIR wavelength (nm)")
	plt.ylabel("Count")
	plt.title(f"Expected energy: {desired_energy}" + " $cm^{-1}$" + "\n" + f"Measured energy: {result['energy']}" + " $cm^{-1}$")





if __name__ == "__main__":
	main()