// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

interface IPrngGenerator {
    // Generates a 256-bit pseudorandom seed using the first 256-bits of running hash of n-3 transaction record.
    // Users can generate a pseudorandom number in a specified range using the seed by (integer value of seed % range)
    function getPseudorandomSeed() external returns (bytes32);

	// Generates a pseudorandom number in the range [lo, hi] using the seed generated from "getPseudorandomSeed"
	function getPseudorandomNumber(uint256 lo, uint256 hi, uint256 userSeed) external returns (uint256);

	// generates a unit256 psuedo random number
	function generateRandomNumber() external returns (uint256);

	// Generates an array of pseudorandom numbers in the range [lo, hi] using the seed generated from "getPseudorandomSeed"
	function getPseudorandomNumberArray(uint256 lo, uint256 hi, uint256 userSeed, uint256 arrayLength) external returns (uint256[] memory);
}