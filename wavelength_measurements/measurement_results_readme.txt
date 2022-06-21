Information for measurement_results_Xir_N.json files

6/14/22
array contains objects with: 
	desired_wl 
	desired_energy
	wavelength
	energy
	wl_difference
	energy_difference
	wl_measurements
		average
		stdev
		iteration_count (reduction iterations, not opo movement)
		initial_values
		final_values

mir_1: (3750 - 3780 cm-1) (~760 nm nIR) Allow up to 4 iterations after first movement
mir_2: (3750 - 3780 cm-1) (~760 nm nIR) Only allow 1 iteration after first movement 
mir_3: (3925 - 2955 cm-1) (~750 nm nIR) " " " "
mir_4: (3750 - 3780 cm-1) (~760 nm nIR) " " " "
fir_1: (1845 - 1875 cm-1) (~760 nm nIR) " " " " 
fir_2: (1500 - 1530 cm-1) (~750 nm nIR) " " " " 



6/15/22
array contains objects with:
	first - first opo mvmt (contains same as below)
	second - second opo mvmt (contains same as below)
	final - last (first or second) opo mvmt 
		desired_wl
		desired_energy
		wavelength
		energy
		opo_wl
		wl_difference
		energy_difference
		wl_measurements
			initial (before reduction)
				average 
				stdev 
				values 
			final (after reduction)
				average 
				stdev
				values
			iteration_count (reduction iterations)

All of these have a default to move to nIR + expected shift of 0.25 nm if wl > 1.5 +- opo_wl 

mir_5: (3750 - 3780 cm-1) (~760 nm nIR) Only allow 1 iteration after first movement
mir_6: (3770 - 3800 cm-1) (~759 nm nIR) " " " " and initially go to desired + expected shift (0.25 nm)
fir_3: (1845 - 1875 cm-1) (~760 nm nIR) " " " " " " " "
	2/3 of these (14 of 21) are shifted up by 10cm-1... Why?
	The issue is adding in opo shift to the second iteration. It only shows an error when two iterations happen
	If you look at the first iteration values (instead of final), average error goes from 5.88 cm-1 -> 0.382 cm-1
mir_7: (3750 - 3780 cm-1) (~760 nm nIR) " ^ ", avg wavelengths for 200 instead of 50, use 0.257 nm shift 
	This had one bad point (3777 cm-1) - Desired wl: 759.461, Measured wl: 725.264, OPO wl: 759.480
		So the OPO was actually where it should be, and this would probably be a valid measurement. Need to come up 
			with a way to combat this 
	If you remove values more than 1 nm away from desired wl, you get an avg, stdev of 759.194, 0.0733 (without reduction)



6/16/22
measure_reduced_wavelength() now removes values > +- 1nm away from the desired nIR wl when calculating 
	the average wavelength. Also removed opo shift from 2nd iteration (so its not double counted)
fir_4: (1845 - 1875 cm-1)
fir_5: (  "  "   "   "  ) Going back to 50 wl measurements (from 200)



6/20/22
Changed IR speed to 0.033 nm/sec, took out delays, and took out initial +1nm step 
OPO shift seems to be 0.03 nm now 
mir_8: (3925 - 3955 cm-1)
For first iteration, move by half wl_difference
mir_9: (  "  "   "   "  )
Changed OPO motors to be 2 counts/sec (like OPA)
mir_10: (  "  "   "   "  )



6/21/22
Eric from Roland's group told me their OPO moves at 0.001 nm/sec. Changed scanning_mode() so that it
	moves to the initial wavelength at 1 nm/sec, then starts loop moving at 0.001 nm/sec 
Took out the iteration, so it only moves once per increment 
mir_11: (3925 - 3955 cm-1)
Added the iteration back 